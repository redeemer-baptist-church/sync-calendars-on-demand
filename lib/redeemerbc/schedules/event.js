const ow = require('ow')
const dayjs = require('dayjs')
const {
  Event: GSuiteCalendarEvent,
} = require('@redeemerbc/gsuite')

class Event {
  constructor(options = {}) {
    ow(options, ow.object.exactShape({
      attendees: ow.array,
      calendarId: ow.string,
      date: ow.number.integer,
      endTime: ow.optional.number.not.integer,
      label: ow.string,
      location: ow.optional.string,
      startTime: ow.optional.number.not.integer,
    }))

    this.props = options
  }

  get calendarId() {
    return this.props.calendarId
  }

  get label() {
    return this.props.label
  }

  get location() {
    return this.props.location
  }

  get attendees() {
    return this.props.attendees
  }

  get excelDate() {
    return this.props.date
  }

  get excelStartTime() {
    return this.props.startTime
  }

  get start() { // for compatibility with Google Calendar Event class
    return this.startTime.toISOString()
  }

  get startTime() {
    return this.excelStartTime
      ? this.parseExcelDateTimestamp(this.excelStartTime)
      : this.date.startOf('day')
  }

  get excelEndTime() {
    return this.props.endTime
  }

  get end() { // for compatibility with Google Calendar Event class
    return this.endTime.toISOString()
  }

  get endTime() {
    return this.excelEndTime
      ? this.parseExcelDateTimestamp(this.excelEndTime)
      : this.date.endOf('day')
  }

  get date() {
    return this.parseExcelDatestamp()
  }

  parseExcelDateTimestamp(excelTime) {
    return this.parseExcelTimestamp(this.excelDate + excelTime)
  }

  parseExcelDatestamp() {
    // TODO: refactor this so parseExcelTimestamp relies on this function instead of vice-versa
    return this.parseExcelTimestamp(this.excelDate)
  }

  parseExcelTimestamp(excelTimestamp) { // eslint-disable-line class-methods-use-this
    // convert legacy Excel format to UTC time - https://stackoverflow.com/a/22352911/421313
    const utcTimestamp = new Date(Math.round((excelTimestamp - 25569) * 86400 * 1000))

    // shift UTC time to the same hour in the current locale
    const localizedTimestamp = utcTimestamp.toISOString().slice(0, -1)
    return dayjs(localizedTimestamp)
  }

  simulateAGoogleCalendarEvent(calendar, peopleMapper) {
    ow(calendar, ow.object)
    ow(peopleMapper, ow.object)

    const description = []
    const attendees = this.attendees.map((attendee) => {
      const person = peopleMapper.personByFullName(attendee)
      if (person) {
        return {email: person.email}
      }

      description.push(attendee) // assume attendee is actually a string like "Family Service"
      return undefined
    }).filter(Boolean)

    return new GSuiteCalendarEvent({
      properties: {
        summary: `${calendar.summary} - ${this.label}`,
        start: {
          dateTime: this.start,
        },
        end: {
          dateTime: this.end,
        },
        description: description.join('\n'),
        attendees,
        location: this.location,
        guestsCanInviteOthers: false,
        reminders: {
          useDefault: false,
          overrides: [
            {
              method: 'email',
              minutes: 60 * 24 * 6, // send a reminder email 6 days before the event
            },
            {
              method: 'popup',
              minutes: 60, // send a reminder popup 1 hour before the event
            },

          ],
        },
      },
      calendar,
    })
  }
}

module.exports = {Event}
