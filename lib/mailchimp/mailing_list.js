const {Member} = require('./member')

class MailingList {
  constructor(listJson, client) {
    this.json = listJson
    this.client = client
  }

  get id() {
    return this.json.id
  }

  get name() {
    return this.json.name
  }

  get members() {
    return this._members || this.getMembers()
  }

  getMembers() {
    console.log(`Getting members for list ${this.id} - "${this.name}"`)
    this._members = this.client.batch({
      method: 'get',
      path: `/lists/${this.id}/members`,
    }).then((json) => {
      json.members.map(member => new Member(member))
    })
    return this._members
  }
}

module.exports = {MailingList}
