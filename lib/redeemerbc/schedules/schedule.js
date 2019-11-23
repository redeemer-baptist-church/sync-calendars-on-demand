const ow = require('ow')
const zip = require('lodash/zip')
const {Event} = require('./event')

class Schedule {
  constructor(options = {}) {
    ow(options, ow.object.exactShape({
      dates: ow.array,
      attendees: ow.array,
      header: ow.object,
    }))
    this.props = options
  }

  get isValid() {
    // For now, a schedule is invalid if it doesn't point to a Google Calendar
    return !!this.calendarLinkMatches
  }

  get header() {
    return this.props.header
  }

  get attendees() {
    return this.props.attendees
  }

  get prevColumn() {
    return this.props.prevColumn
  }

  get calendarLinkMatches() {
    return this.calendarLink.match(/\?cid=(?<cid>[^"]+)","(?<label>[^"]+)/)
  }

  get calendarLinkParser() {
    return this.calendarLinkMatches.groups
  }

  get calendarLink() {
    return this.header.calendarCell
  }

  get calendarId() {
    // the cid param in the url is a base64 representation of the real calendarId
    return Buffer.from(this.calendarLinkParser.cid, 'base64').toString()
  }

  get calendarLabel() {
    return this.calendarLinkParser.label
  }

  get eventLabel() {
    return this.calendarLabel.replace('\n', ' ')
  }

  get startTime() {
    return this.header.startTimeCell
  }

  get endTime() {
    return this.header.endTimeCell
  }

  get rows() {
    return zip(this.dates, this.attendees).reduce((rows, [date, attendee]) => {
      // TODO: Row object
      let row

      if (date) {
        // if this is the first time we've found this date, start a new row
        row = {date: undefined, attendees: []}
        row.date = date
      } else {
        // if we are still processing the same date, fetch the last row we used
        row = rows.pop()
      }

      if (attendee) {
        row.attendees.push(attendee)
      }

      rows.push(row)
      return rows
    }, [])
  }

  get dates() {
    return this.props.dates
  }

  get events() {
    return this._events || this.buildEvents()
  }

  buildEvents() {
    this._events = this.rows.map(row => new Event({
      date: row.date,
      calendarId: this.calendarId,
      label: this.eventLabel,
      attendees: row.attendees,
      startTime: this.startTime,
      endTime: this.endTime,
    }))
    return this._events
  }
}

module.exports = {Schedule}
