import { NavLink } from 'react-router-dom'

function NavBar() {
  return (
    <nav>
      <NavLink to="/">Inicio</NavLink>
      {' | '}
      <NavLink to="/peliculas">Películas</NavLink>
      {' | '}
      <NavLink to="/series">Series</NavLink>
      {' | '}
      <NavLink to="/favoritos">Mis favoritos</NavLink>
    </nav>
  )
}

export default NavBar