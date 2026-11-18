import { NavLink } from 'react-router-dom'

function NavBar() {
  return (
    <nav className="navbar">
      <div className="nav-links">
        <NavLink to="/" end>Inicio</NavLink>
        <NavLink to="/peliculas">Películas</NavLink>
        <NavLink to="/series">Series</NavLink>
        <NavLink to="/soporiferas">Más soporíferas</NavLink>
        <NavLink to="/favoritos">Mis favoritos</NavLink>
      </div>
    </nav>
  )
}

export default NavBar