// tailwind.nyt.js — NYT design tokens for Tailwind CDN
// Usage: <script src="https://cdn.tailwindcss.com"></script>
//        <script src="tailwind.nyt.js"></script>

tailwind.config = {
  theme: {
    extend: {
      fontFamily: {
        'franklin': ['nyt-franklin', '-apple-system', 'BlinkMacSystemFont', 'Helvetica Neue', 'sans-serif'],
        'cheltenham': ['nyt-cheltenham', 'Georgia', 'Times New Roman', 'serif'],
        'karnak': ['nyt-karnak', 'Georgia', 'serif'],
      },
      colors: {
        'nyt': {
          'fg': '#121212',
          'dim': '#5a5a5a',
          'faint': '#8b8b8b',
          'bg': '#ffffff',
          'bg-alt': '#f5f5f2',
          'border': '#ececec',
          'border-strong': '#c7c7c7',
          'accent': '#326891',
          'red': '#c13b2a',
          'orange': '#b87a00',
          'green': '#3f7f63',
        }
      },
      fontSize: {
        'xs': '11px',
        'sm': '13px',
        'base': '15px',
        'md': '17px',
        'lg': '20px',
        'xl': '26px',
        '2xl': '34px',
        '3xl': '42px',
      },
    }
  }
}
