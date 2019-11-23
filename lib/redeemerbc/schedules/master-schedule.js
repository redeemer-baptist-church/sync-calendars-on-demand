const ow = require('ow')
const zip = require('lodash/zip')
const {MasterHeader} = require('./master-header')
const {Schedule} = require('./schedule')

class MasterSchedule {
  constructor(options = {}) {
    ow(options, ow.object.exactShape({
      data: ow.object,
      sheet: ow.object,
    }))
    this.props = options
  }

  get sheet() {
    return this.props.sheet
  }

  get grid() {
    return this.props.data.values
  }

  get dataColumns() {
    return this._dataColumns || this.buildDataColumns()
  }

  buildDataColumns() {
    // all rows below the header rows contain data such as dates or attendees
    this._dataColumns = this.grid.map(column => column.slice(this.headerHeight))
    return this._dataColumns
  }

  get masterHeader() {
    return this._masterHeader || this.buildMasterHeader()
  }

  buildMasterHeader() {
    this._masterHeader = new MasterHeader(this.headerColumns)
    return this._masterHeader
  }

  get headerColumns() {
    // the header consists of all frozen rows, minus the useless top title row
    return this.grid.map(column => column.slice(1, this.headerHeight))
  }

  get dates() {
    // the zeroth column is the dates
    // all other columns are lists of attendees
    return this.dataColumns[0]
  }

  get attendees() {
    // the zeroth column is the dates
    // all other columns are lists of attendees
    return this.dataColumns.slice(1)
  }

  get headers() {
    return this.masterHeader.subHeaders
  }

  get headerHeight() {
    return this.sheet.frozenRowCount
  }

  get subSchedules() {
    return zip(this.headers, this.attendees).map(([header, attendees]) => new Schedule({
      dates: this.dates,
      header,
      attendees,
    })).filter(subSchedule => subSchedule.isValid)
  }
}

module.exports = {MasterSchedule}
