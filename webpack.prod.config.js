const path = require('path');

module.exports = {
  mode: 'production',
  entry: './js/app.js',
  externals: {
    'xlsx': 'XLSX'
  },
  experiments: {
    topLevelAwait: true
  },
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'public/dist'),
  },
  resolve: {
    extensions: ['.js'],
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env']
          }
        }
      }
    ]
  }
};
