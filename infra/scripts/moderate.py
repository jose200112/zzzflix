#!/usr/bin/env python3
"""Moderación de comentarios de zzzflix (se ejecuta en tu terminal).

Uso (desde ~/zzzflix, con la sesión de AWS activa):
    ~/.venvs/zzzflix-tools/bin/python infra/scripts/moderate.py

Qué hace:
  - Lista los comentarios pendientes y deja aprobarlos, rechazarlos o banear
    a su autor.
  - Al aprobar un comentario, su nota (1-5) entra en la media de la película;
    al borrar uno aprobado, sale. Ambas cosas ocurren en una transacción
    (o todo o nada), así que la media nunca queda descuadrada.
  - El baneo se guarda como un hash de la IP (la misma función que usa la
    Lambda). Nunca se ve ni se guarda la IP en claro.
"""

import hashlib
import hmac
import sys
import unicodedata

import boto3
from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError

REGION = "eu-north-1"
TABLE = "zzzflix-comments"
SALT_PARAM = "/zzzflix/ip-salt"

db = boto3.resource("dynamodb", region_name=REGION)
table = db.Table(TABLE)
ssm = boto3.client("ssm", region_name=REGION)
_salt = None


# --- Utilidades ---------------------------------------------------


def clean(s):
    """Quita caracteres de control: un comentario podría traer secuencias de
    escape que manipulen tu terminal al imprimirlo."""
    return "".join(c for c in str(s) if unicodedata.category(c)[0] != "C")


def _ip_salt():
    global _salt
    if _salt is None:
        out = ssm.get_parameter(Name=SALT_PARAM, WithDecryption=True)
        _salt = out["Parameter"]["Value"]
    return _salt


def ip_id(ip):
    # Debe ser idéntico a la Lambda: HMAC-SHA256("ban|" + ip) con la sal de SSM,
    # recortado a 32 caracteres hex
    return hmac.new(_ip_salt().encode(), f"ban|{ip}".encode(), hashlib.sha256).hexdigest()[:32]


def fetch(status):
    items, kwargs = [], {"FilterExpression": Attr("status").eq(status)}
    while True:
        out = table.scan(**kwargs)
        items += out["Items"]
        if "LastEvaluatedKey" not in out:
            break
        kwargs["ExclusiveStartKey"] = out["LastEvaluatedKey"]
    return sorted(items, key=lambda i: i["createdAt"])


def show(items, title):
    print(f"\n=== {title} ({len(items)}) ===")
    for n, i in enumerate(items, 1):
        stars = f"★{int(i['rating'])}" if "rating" in i else "sin nota"
        ban = "" if i.get("ipId") else " [sin ipId: no baneable]"
        print(
            f"{n:>3}) película {i['titleId']} · {i['createdAt'][:16]} · "
            f"{clean(i['nickname'])} · {stars}{ban}"
        )
        print(f"     {clean(i['text'])}")


# --- Acciones -----------------------------------------------------


def approve(i):
    ops = [
        {
            "Update": {
                "TableName": TABLE,
                "Key": {"titleId": i["titleId"], "sk": i["sk"]},
                "UpdateExpression": "SET #s = :a",
                "ConditionExpression": "#s = :p",
                "ExpressionAttributeNames": {"#s": "status"},
                "ExpressionAttributeValues": {":a": "approved", ":p": "pending"},
            }
        }
    ]
    if "rating" in i:
        ops.append(
            {
                "Update": {
                    "TableName": TABLE,
                    "Key": {"titleId": "#ratings", "sk": i["titleId"]},
                    "UpdateExpression": "ADD #sum :r, #count :one",
                    "ExpressionAttributeNames": {"#sum": "sum", "#count": "count"},
                    "ExpressionAttributeValues": {":r": i["rating"], ":one": 1},
                }
            }
        )
    db.meta.client.transact_write_items(TransactItems=ops)


def delete(i, status):
    """Borra un comentario. Si estaba aprobado, también resta su nota."""
    ops = [
        {
            "Delete": {
                "TableName": TABLE,
                "Key": {"titleId": i["titleId"], "sk": i["sk"]},
                "ConditionExpression": "#s = :st",
                "ExpressionAttributeNames": {"#s": "status"},
                "ExpressionAttributeValues": {":st": status},
            }
        }
    ]
    if status == "approved" and "rating" in i:
        ops.append(
            {
                "Update": {
                    "TableName": TABLE,
                    "Key": {"titleId": "#ratings", "sk": i["titleId"]},
                    "UpdateExpression": "ADD #sum :r, #count :one",
                    "ExpressionAttributeNames": {"#sum": "sum", "#count": "count"},
                    "ExpressionAttributeValues": {
                        ":r": -i["rating"],
                        ":one": -1,
                    },
                }
            }
        )
    db.meta.client.transact_write_items(TransactItems=ops)


def ban(ident):
    table.put_item(
        Item={"titleId": "#bans", "sk": ident, "bannedAt": _now()}
    )


def _now():
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def ban_author(i, pending):
    """Banea al autor y borra todos sus comentarios pendientes."""
    ident = i.get("ipId")
    if not ident:
        print("  Este comentario no tiene ipId (es anterior al sistema de baneo).")
        return
    ban(ident)
    removed = 0
    for p in pending:
        if p.get("ipId") == ident:
            try:
                delete(p, "pending")
                removed += 1
            except ClientError:
                pass
    print(f"  Autor baneado. Pendientes suyos borrados: {removed}.")
    approved = [a for a in fetch("approved") if a.get("ipId") == ident]
    if approved:
        print(
            f"  OJO: tiene {len(approved)} comentario(s) ya aprobado(s). "
            "Bórralos desde la vista 'ok' con 'x N'."
        )


def list_bans():
    out = table.query(
        KeyConditionExpression="titleId = :t",
        ExpressionAttributeValues={":t": "#bans"},
    )
    return sorted(out["Items"], key=lambda i: i["bannedAt"])


# --- Interruptor de emergencia de los comentarios -----------------

SWITCH_KEY = {"titleId": "#flags", "sk": "comments"}


def switch_status():
    item = table.get_item(Key=SWITCH_KEY).get("Item")
    if item and item.get("disabled"):
        print(
            f"  CERRADO desde {clean(item.get('at', '?'))} "
            f"(motivo: {clean(item.get('reason', '?'))}). Reábrelo con 'abrir'."
        )
    else:
        print("  Abierto: la Lambda acepta comentarios.")
        print("  (Si no los acepta, mira también comments_enabled en Terraform.)")


def switch_close():
    table.put_item(
        Item={**SWITCH_KEY, "disabled": True, "reason": "manual", "at": _now()}
    )


def switch_open():
    table.delete_item(Key=SWITCH_KEY)


# --- Interfaz -----------------------------------------------------

HELP = """
Comandos (los números son los de la lista que ves):
  a 1 2 3     aprobar
  r 4         rechazar (borrar) un pendiente
  b 5         banear al autor del comentario 5 y borrar sus pendientes
  p           ver pendientes
  ok          ver aprobados
  x 2         borrar un aprobado (le resta su nota a la media)
  banip IP    banear una IP (por ejemplo la que ves en los logs de la API)
  bans        ver baneos
  unban 1     quitar un baneo (de la lista 'bans')
  estado      ver si los comentarios están abiertos o cerrados
  cerrar      cerrar los comentarios nuevos (interruptor de emergencia)
  abrir       reabrirlos (por ejemplo, tras una alarma)
  h           ayuda
  q           salir
"""


def numbers(args, total):
    out = []
    for a in args:
        if not a.isdigit() or not 1 <= int(a) <= total:
            print(f"  '{a}' no es un número válido de la lista.")
            return []
        out.append(int(a) - 1)
    return out


def main():
    mode = "pending"
    items = fetch("pending")
    show(items, "Pendientes")
    bans = []
    print(HELP)

    while True:
        try:
            line = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return
        if not line:
            continue
        cmd, *args = line.split()

        try:
            if cmd == "q":
                return
            elif cmd == "h":
                print(HELP)
            elif cmd == "estado":
                switch_status()
            elif cmd == "cerrar":
                switch_close()
                print("  Comentarios CERRADOS.")
            elif cmd == "abrir":
                switch_open()
                print("  Comentarios ABIERTOS.")
            elif cmd == "p":
                mode, items = "pending", fetch("pending")
                show(items, "Pendientes")
            elif cmd == "ok":
                mode, items = "approved", fetch("approved")
                show(items, "Aprobados")
            elif cmd == "bans":
                mode, bans = "bans", list_bans()
                print(f"\n=== Baneos ({len(bans)}) ===")
                for n, b in enumerate(bans, 1):
                    print(f"{n:>3}) {b['sk'][:12]}… desde {b['bannedAt']}")
            elif cmd == "banip" and len(args) == 1:
                ban(ip_id(args[0]))
                print("  IP baneada.")
            elif cmd == "unban" and args:
                for n in numbers(args, len(bans)):
                    table.delete_item(Key={"titleId": "#bans", "sk": bans[n]["sk"]})
                    print(f"  Baneo {n + 1} quitado.")
                bans = list_bans()
            elif cmd in ("a", "r", "b") and mode != "pending":
                print("  Esto solo funciona en la vista de pendientes (p).")
            elif cmd in ("x",) and mode != "approved":
                print("  Esto solo funciona en la vista de aprobados (ok).")
            elif cmd == "a" and args:
                for n in numbers(args, len(items)):
                    approve(items[n])
                    print(f"  Aprobado {n + 1}.")
                items = fetch("pending")
                show(items, "Pendientes")
            elif cmd == "r" and args:
                for n in numbers(args, len(items)):
                    delete(items[n], "pending")
                    print(f"  Rechazado {n + 1}.")
                items = fetch("pending")
                show(items, "Pendientes")
            elif cmd == "b" and len(args) == 1:
                for n in numbers(args, len(items)):
                    ok = input(
                        f"  ¿Banear al autor de '{clean(items[n]['nickname'])}'? (s/N) "
                    )
                    if ok.lower() == "s":
                        ban_author(items[n], items)
                items = fetch("pending")
                show(items, "Pendientes")
            elif cmd == "x" and args:
                for n in numbers(args, len(items)):
                    delete(items[n], "approved")
                    print(f"  Borrado {n + 1}.")
                items = fetch("approved")
                show(items, "Aprobados")
            else:
                print("  No entiendo. Escribe h para ver la ayuda.")
        except ClientError as e:
            code = e.response["Error"]["Code"]
            if code == "TransactionCanceledException":
                print("  No se pudo: el comentario ya cambió (¿lo moderaste antes?). Refresca con p/ok.")
            else:
                print(f"  Error de AWS: {code}")


if __name__ == "__main__":
    sys.exit(main())
