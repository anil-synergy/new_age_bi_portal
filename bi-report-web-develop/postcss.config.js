/* eslint-disable global-require */
/* eslint-disable import/no-extraneous-dependencies */
// const purgecss = require('@fullhuman/postcss-purgecss');

module.exports = {
  plugins: [
    require('postcss-import'),
    require('postcss-preset-env')({
      stage: 1,
      features: {
        'focus-within-pseudo-class': false
      }
    }),
    require('autoprefixer'),
    require('postcss-nested'),
    require('cssnano')(),
    require('postcss-fontpath')
  ]
};
