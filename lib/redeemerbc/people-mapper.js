// Some GSuite products describe people by email address, others by name
// Given a list of Google People (from the Contacts) API, this class
// will attempt to map among the various types of GSuite people objects.
// Many caveats apply...

class PeopleMapper {
  constructor(listOfPeople) {
    this._mapOfPeopleByEmail = listOfPeople.reduce((map, person) => {
      map[person.email.toLowerCase()] = person // eslint-disable-line no-param-reassign
      return map
    }, {})
    this._mapOfPeopleByFullName = listOfPeople.reduce((map, person) => {
      map[person.fullName.toLowerCase()] = person // eslint-disable-line no-param-reassign
      return map
    }, {})
  }

  personByFullName(fullName) {
    return this._mapOfPeopleByFullName[fullName.toLowerCase()]
  }

  personByEmail(email) {
    return this._mapOfPeopleByEmail[email.toLowerCase()]
  }
}

module.exports = {PeopleMapper}
