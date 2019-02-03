module.exports = {
  "env": {
      "jest/globals": true,
      "node": true,
  },
  "extends": [
    "airbnb-base",
    "plugin:jest/recommended",
    "plugin:jest/style",
  ],
  "plugins": [
    "jest",
  ],
  "rules": {
     "jest/consistent-test-it": ["error"],
     "jest/expect-expect": ["error"],
     "no-console": "off",
      "semi": [
          "error",
          "never"
      ],
      "no-underscore-dangle": [
        "error",
        { "allowAfterThis": true }
      ],
      "object-curly-spacing": [
        "error",
        "never"
      ]
  }
};
