function Footer() {
  return (
    <footer className="footer">
      <a
        className="footer-tmdb"
        href="https://www.themoviedb.org"
        target="_blank"
        rel="noreferrer"
      >
        <img src="/tmdb-logo.svg" alt="The Movie Database (TMDB)" />
      </a>
      <p>
        This product uses the TMDB API but is not endorsed or certified by{' '}
        <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">
          TMDB
        </a>
        .
      </p>
    </footer>
  )
}

export default Footer
