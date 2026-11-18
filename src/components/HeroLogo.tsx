import { useLocation } from 'react-router-dom'
import logo from '../assets/logo-zzzflix.webp'

function HeroLogo() {
  const { pathname } = useLocation()

  if (pathname.startsWith('/titulo/')) {
    return null
  }

  return <img src={logo} alt="zzzflix" className="hero-logo" />
}

export default HeroLogo