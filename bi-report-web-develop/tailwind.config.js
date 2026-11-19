module.exports = {
  purge: ['./src/**/*.{js,jsx,ts,tsx}', './public/index.html'],
  darkMode: false, // or 'media' or 'class'
  theme: {
    fontFamily: {
      montserrat: ['Montserrat-Normal', 'sans-serif'],
      muli: ['Mulish', 'sans-serif'],
      body: ['Mulish', 'sans-serif'],
      display: ['Montserrat', 'sans-serif']
    },
    screens: {
      sm: '576px',
      md: '768px',
      lg: '992px',
      xl: '1280px',
      xxl: '1320px',
      mScreen: { min: '1500px', max: '1900px' }
    },

    colors: {
      primary: {
        50: '#e5e6eb',
        100: '#bdbfce',
        500: '#6e7194',
        900: '#333869'
      },
      secondary: {
        50: '#e9eaf3',
        100: '#c8cbe6',
        500: '#868dcd',
        900: '#565fbb'
      },
      amber: {
        50: '#f9f2e2',
        100: '#f8e3b4',
        200: '#f8c657',
        500: '#f8b113'
      },
      red: {
        50: '#f9e9e8',
        100: '#f8c8c5',
        500: '#f5564e',
        900: '#f88078'
      },
      green: {
        50: '#e5f4ed',
        100: '#bcebd5',
        200: '#6cd9a5',
        500: '#21c979',
        900: '#7bc67e'
      },
      gray: {
        50: '#D4D4D4',
        100: '#BEBEBE',
        200: '#838383',
        500: '#4a4a4a'
      },
      black: '#2c2c2c',
      watch: '#565FBB',
      white: {
        light: '#ffffff',
        DEFAULT: '#fdfdff',
        medium: '#f0f3fb',
        dark: '#f1f1f1'
      },
      fade: {
        color: '#e9eaf3'
      }
    },
    flex: {
      1: '1 1 0%',
      auto: '1 1 auto',
      initial: '0 1 auto',
      inherit: 'inherit',
      none: 'none',
      2: '2 2 0%',
      0: '0 0 0%',
      '1/2': '0.5 1 0%'
    },
    borderWidth: {
      DEFAULT: '1px',
      1: '0',
      2: '2px',
      3: '3px',
      4: '4px',
      6: '6px',
      8: '8px'
    },
    spacing: {
      28.5: '7.5rem',
      22: '5.5rem',
      4: '0.75rem',
      6: '1.25rem',
      8: '1.75rem',
      12: '2.75rem',
      15: '3.75rem',
      17: '4.25rem',
      18: '4.5rem',
      19: '4.75rem'
    },
    extend: {
      width: {
        30: '7.5rem',
        204: '51.3rem',
        133: '33.3rem',
        150: '37.5rem',
        35: '8.75rem',
        34: '8.31rem'
      },
      height: {
        10: '2.5rem',
        30: '7.5rem',
        98: '26.25rem',
        120: '30rem'
      },
      margin: {
        1.2: '.313rem'
      },
      screens: {
        xxl: '1500px'
      },
      maxWidth: {
        19: '4.75rem'
      }
    },
    flexGrow: {
      2: 2,
      3: 3
    },
    minWidth: {
      32: '8rem'
    }
  },
  variants: {
    extend: {
      backgroundColor: ['even']
    }
  },
  plugins: []
};
