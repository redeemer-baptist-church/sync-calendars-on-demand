module.exports = {
  sleep: function sleep(ms) {
    // inspired by https://stackoverflow.com/a/39914235/421313
    return new Promise(resolve => setTimeout(resolve, ms))
  },
}
