const ow = require('ow')
const {Header} = require('./header')

class MasterHeader {
  constructor(headerColumns) {
    ow(headerColumns, ow.array)
    this.headerColumns = headerColumns
  }

  get labels() {
    return this.headerColumns[0].map(label => label.toLowerCase())
  }

  get columns() {
    return this.headerColumns.slice(1)
  }

  get subHeaders() {
    return this._subHeaders || this.buildSubHeaders()
  }

  buildSubHeaders() {
    this._subHeaders = this.columns.map(column => new Header({
      labels: this.labels,
      column,
    }))
    return this._subHeaders
  }
}

module.exports = {MasterHeader}
