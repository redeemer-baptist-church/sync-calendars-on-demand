const ow = require('ow')
const {Schedule} = require('./schedule')

class MasterSchedule {
  constructor(options = {}) {
    ow(options, ow.object.exactShape({
      data: ow.object,
    }))
    this.props = options
  }

  get parser() {
    return this._parser || this.buildParser()
  }

  buildParser() {
    this._parser = {
      attendees: this.parsedAttendees,
      dates: this.parsedDates,
      headers: this.parsedHeaders,
    }

    return this._parser
  }

  get data() {
    return this.props.data
  }

  get values() {
    return this.data.values
  }

  get columns() {
    return this.values.map(column => column.slice(this.headerHeight))
  }

  get headerRows() {
    // the zeroth column is the dates, so slice it off
    // and trim off all rows past headerHeight
    return this.values.map(column => column.slice(0, this.headerHeight)).slice(1)
  }

  get parsedHeaders() {
    return this.headerRows.map(row => ({
      calendarCell: row[2],
      startTimeCell: row[3],
      endTimeCell: row[4],
    }))
  }

  get parsedDates() {
    // the zeroth column is the dates
    // all other columns are lists of attendees
    return this.columns[0]
  }

  get parsedAttendees() {
    // the zeroth column is the dates
    // all other columns are lists of attendees
    return this.columns.slice(1)
  }

  get attendees() {
    return this.parser.attendees
  }

  get dates() {
    return this.parser.dates
  }

  get headers() {
    return this.parser.headers
  }

  get title() {
    return this.columns[0][0]
  }

  get headerHeight() { // eslint-disable-line class-methods-use-this
    // TODO: can we get this from the sheet? Number of frozen rows?
    return 5
  }

  get subSchedules() {
    // TODO: more explicitly loop over a column count
    return this.parsedAttendees.map((_, index) => new Schedule({
      dates: this.dates,
      header: this.headers[index],
      attendees: this.attendees[index],
    })).filter(subSchedule => subSchedule.isValid)
  }
}

module.exports = {MasterSchedule}
