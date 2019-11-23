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
      endTime: ow.number.not.integer,
      label: ow.string,
      location: ow.string,
      startTime: ow.number.not.integer,
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

  get date() {
    return this.props.date
  }

  get startTime() {
    return this.props.startTime
  }

  get endTime() {
    return this.props.endTime
  }

  get startDateTime() {
    return this.parseExcelTimestamp(this.date + this.startTime)
  }

  get endDateTime() {
    return this.parseExcelTimestamp(this.date + this.endTime)
  }

  parseExcelDatestamp() {
    // TODO: refactor this so parseExcelTimestamp relies on this function instead of vice-versa
    return this.parseExcelTimestamp(this.date)
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

      description.push(attendee) // assumume attendee is actually a string like "Family Service"
      return undefined
    }).filter(Boolean)

    return new GSuiteCalendarEvent({
      properties: {
        summary: `${calendar.summary} - ${this.label}`,
        start: {
          dateTime: this.startDateTime.toISOString(),
        },
        end: {
          dateTime: this.endDateTime.toISOString(),
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
