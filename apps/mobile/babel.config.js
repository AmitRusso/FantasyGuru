module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      // jsxImportSource is what routes className props through NativeWind's runtime.
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
  };
};
