const ow = require('ow')

class Header {
  constructor(options = {}) {
    ow(options, ow.object.exactShape({
      labels: ow.array,
      column: ow.array,
    }))
    this.props = options
  }

  get labels() {
    return this.props.labels
  }

  get column() {
    return this.props.column
  }

  get(label) {
    const index = this.labels.indexOf(label.toLowerCase())
    return this.column[index]
  }
}

module.exports = {Header}
