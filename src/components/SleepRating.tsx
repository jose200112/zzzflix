type SleepRatingProps = {
  score: number
}

function SleepRating({ score }: SleepRatingProps) {
  return (
    <p className="sleep" aria-label={`Nivel de soporífero: ${score} de 5`}>
      {'💤'.repeat(score)}
      <span className="sleep-off">{'💤'.repeat(5 - score)}</span>
    </p>
  )
}

export default SleepRating