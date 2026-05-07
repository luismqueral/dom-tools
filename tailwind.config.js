/**
 * Tailwind config for dom-tools.
 *
 * Strategy: precompile a single static CSS file that's loaded into pages via
 * <link rel="stylesheet">. We do NOT use the CDN/JIT runtime — it crashed
 * pages and adds runtime cost on every classList mutation in design mode.
 *
 * Two sources feed the build:
 *   1. content scan (index.html, src/) — picks up classes used literally in
 *      the demo page and any arbitrary-value classes (e.g. text-[15px]).
 *   2. safelist (below) — the headroom set, so users typing freeform classes
 *      in design mode's "Classes" editor get coverage without rebuilding.
 *
 * If a user-typed class falls outside the safelist, add a regex here and
 * re-run `npm run build:css`. Don't add `content: ['**\/*']` — that defeats
 * the bounded-output guarantee.
 */

const COLOR_FAMILIES = [
  'transparent', 'current', 'inherit', 'black', 'white',
  'slate', 'gray', 'zinc', 'neutral', 'stone',
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal',
  'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
  'nyt',
].join('|');

const COLOR_SHADES = '50|100|200|300|400|500|600|700|800|900|950';
const COLOR_PATTERN = `^(text|bg|border|ring|divide|outline|fill|stroke|placeholder|caret|accent|decoration|from|via|to)-(${COLOR_FAMILIES})(-(${COLOR_SHADES}))?$`;

const SPACING_SCALE = '0|0\\.5|1|1\\.5|2|2\\.5|3|3\\.5|4|5|6|7|8|9|10|11|12|14|16|20|24|28|32|36|40|44|48|52|56|60|64|72|80|96|px|auto';
const SPACING_PATTERN = `^-?(p|m|gap|space-x|space-y|inset|top|right|bottom|left|start|end)([trblxyse])?-(${SPACING_SCALE})$`;

const SIZE_SCALE = '0|0\\.5|1|1\\.5|2|2\\.5|3|3\\.5|4|5|6|7|8|9|10|11|12|14|16|20|24|28|32|36|40|44|48|52|56|60|64|72|80|96|auto|px|full|screen|min|max|fit|prose|none|xs|sm|md|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl';
const SIZE_PATTERN = `^(w|h|min-w|min-h|max-w|max-h|size)-(${SIZE_SCALE}|1/2|1/3|2/3|1/4|2/4|3/4|1/5|2/5|3/5|4/5|1/6|2/6|3/6|4/6|5/6|1/12|11/12)$`;

module.exports = {
  important: true,
  content: [
    './index.html',
    './src/**/*.{js,html}',
  ],
  safelist: [
    // Display + position
    { pattern: /^(block|inline-block|inline|flex|inline-flex|grid|inline-grid|hidden|contents|table|table-(cell|row|caption|column|header-group|footer-group|row-group|column-group))$/ },
    { pattern: /^(static|fixed|absolute|relative|sticky)$/ },

    // Flex / grid
    { pattern: /^flex-(row|row-reverse|col|col-reverse|wrap|wrap-reverse|nowrap|1|auto|initial|none)$/ },
    { pattern: /^(grow|shrink)(-0)?$/ },
    { pattern: /^(justify|items|content|self|place-(items|content|self))-(start|end|center|between|around|evenly|stretch|baseline|auto|normal)$/ },
    { pattern: /^grid-(cols|rows)-(none|1|2|3|4|5|6|7|8|9|10|11|12)$/ },
    { pattern: /^(col|row)-span-(full|1|2|3|4|5|6|7|8|9|10|11|12)$/ },
    { pattern: /^order-(none|first|last|\d+)$/ },

    // Spacing
    { pattern: new RegExp(SPACING_PATTERN) },

    // Sizing
    { pattern: new RegExp(SIZE_PATTERN) },

    // Typography
    { pattern: /^text-(xs|sm|base|md|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/ },
    { pattern: /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black|sans|serif|mono|franklin|cheltenham|karnak)$/ },
    { pattern: /^leading-(none|tight|snug|normal|relaxed|loose|3|4|5|6|7|8|9|10)$/ },
    { pattern: /^tracking-(tighter|tight|normal|wide|wider|widest)$/ },
    { pattern: /^(italic|not-italic|underline|overline|line-through|no-underline|uppercase|lowercase|capitalize|normal-case|truncate|antialiased|subpixel-antialiased)$/ },
    { pattern: /^text-(left|center|right|justify|start|end)$/ },
    { pattern: /^(whitespace|break|hyphens)-/ },
    { pattern: /^list-(none|disc|decimal|inside|outside)$/ },

    // Colors (text / bg / border / ring / etc.)
    { pattern: new RegExp(COLOR_PATTERN) },
    // Slash-opacity variants (e.g. bg-blue-500/30) — full coverage since this
    // tool runs offline; bundle size doesn't matter.
    { pattern: new RegExp(`^(text|bg|border|ring|divide|outline|placeholder|caret|accent|decoration|from|via|to)-(${COLOR_FAMILIES})(-(${COLOR_SHADES}))?\\/(0|5|10|15|20|25|30|40|50|60|70|75|80|90|95|100)$`) },

    // Borders
    { pattern: /^border(-(0|2|4|8|x|y|t|r|b|l|s|e))?(-(0|2|4|8))?$/ },
    { pattern: /^border-(solid|dashed|dotted|double|hidden|none)$/ },
    { pattern: /^rounded(-(none|sm|md|lg|xl|2xl|3xl|full|t|r|b|l|tl|tr|br|bl|s|e|ss|se|es|ee))?(-(none|sm|md|lg|xl|2xl|3xl|full))?$/ },
    { pattern: /^ring(-(0|1|2|4|8|inset))?$/ },
    { pattern: /^outline(-(0|1|2|4|8|none|dashed|dotted|double|offset-(0|1|2|4|8)))?$/ },

    // Effects
    { pattern: /^shadow(-(sm|md|lg|xl|2xl|inner|none))?$/ },
    { pattern: /^opacity-(0|5|10|15|20|25|30|40|50|60|70|75|80|90|95|100)$/ },
    { pattern: /^(blur|brightness|contrast|grayscale|hue-rotate|invert|saturate|sepia|backdrop-blur|backdrop-brightness)/ },
    { pattern: /^(mix-blend|bg-blend)-/ },

    // Backgrounds
    { pattern: /^bg-(fixed|local|scroll|clip-(border|padding|content|text)|origin-(border|padding|content)|repeat|no-repeat|repeat-x|repeat-y|cover|contain|auto|center|top|bottom|left|right)$/ },
    { pattern: /^bg-gradient-to-(t|tr|r|br|b|bl|l|tl)$/ },

    // Overflow / object / position
    { pattern: /^overflow(-x|-y)?-(auto|hidden|clip|visible|scroll)$/ },
    { pattern: /^object-(contain|cover|fill|none|scale-down|center|top|bottom|left|right|left-top|left-bottom|right-top|right-bottom)$/ },
    { pattern: /^z-(0|10|20|30|40|50|auto)$/ },

    // Transforms
    { pattern: /^(translate|rotate|scale|skew|origin)-/ },
    { pattern: /^(transform|transform-none|transform-gpu)$/ },

    // Transitions
    { pattern: /^transition(-(none|all|colors|opacity|shadow|transform))?$/ },
    { pattern: /^duration-(75|100|150|200|300|500|700|1000)$/ },
    { pattern: /^ease-(linear|in|out|in-out)$/ },
    { pattern: /^delay-(75|100|150|200|300|500|700|1000)$/ },
    { pattern: /^animate-(none|spin|ping|pulse|bounce)$/ },

    // Cursor / pointer / select
    { pattern: /^cursor-/ },
    { pattern: /^pointer-events-(none|auto)$/ },
    { pattern: /^select-(none|text|all|auto)$/ },
    { pattern: /^resize(-(none|x|y))?$/ },

    // Misc
    'sr-only', 'not-sr-only',
    'isolate', 'isolation-auto',
    'aspect-auto', 'aspect-square', 'aspect-video',
  ],
  theme: {
    extend: {
      fontFamily: {
        franklin: ['nyt-franklin', '-apple-system', 'BlinkMacSystemFont', 'Helvetica Neue', 'sans-serif'],
        cheltenham: ['nyt-cheltenham', 'Georgia', 'Times New Roman', 'serif'],
        karnak: ['nyt-karnak', 'Georgia', 'serif'],
      },
      colors: {
        nyt: {
          fg: '#121212',
          dim: '#5a5a5a',
          faint: '#8b8b8b',
          bg: '#ffffff',
          'bg-alt': '#f5f5f2',
          border: '#ececec',
          'border-strong': '#c7c7c7',
          accent: '#326891',
          red: '#c13b2a',
          orange: '#b87a00',
          green: '#3f7f63',
        },
      },
      fontSize: {
        xs: '11px',
        sm: '13px',
        base: '15px',
        md: '17px',
        lg: '20px',
        xl: '26px',
        '2xl': '34px',
        '3xl': '42px',
        '4xl': '52px',
        '5xl': '64px',
      },
      keyframes: {
        'gradient-shift': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
      },
      animation: {
        'gradient-shift': 'gradient-shift 8s ease infinite',
      },
    },
  },
  plugins: [],
};
