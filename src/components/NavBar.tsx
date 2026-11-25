import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import LanguageSwitcher from './LanguageSwitcher'

function NavBar() {
  const { t } = useTranslation()

  return (
    <nav className="navbar">
      <div className="nav-links">
        <NavLink to="/" end>{t('nav.home')}</NavLink>
        <NavLink to="/peliculas">{t('nav.movies')}</NavLink>
        <NavLink to="/series">{t('nav.series')}</NavLink>
        <NavLink to="/soporiferas">{t('nav.sleepiest')}</NavLink>
        <NavLink to="/favoritos">{t('nav.favorites')}</NavLink>
        <LanguageSwitcher />
      </div>
    </nav>
  )
}

export default NavBar
