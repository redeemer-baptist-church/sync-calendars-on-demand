const ow = require('ow')

class GroupManager {
  constructor(options) {
    ow(options, ow.object.exactShape({
      domain: ow.string,
      connection: ow.object,
    }))
    this.props = options
  }

  get connection() {
    return this.props.connection
  }

  get domain() {
    return this.props.domain
  }

  async createGroups(groupNames) {
    return groupNames.map(groupName => this.createGroup(groupName))
  }

  async createGroup(groupName) {
    console.info('GSuiteGroupManager: creating group:', groupName)
    const email = this.buildEmail(groupName)
    return this.connection.groups.insert({requestBody: {email}}).catch(e => this.error(e))
  }

  async deleteGroups(groupNames) {
    return groupNames.map(groupName => this.deleteGroup(groupName))
  }

  async deleteGroup(groupName) {
    console.info('GSuiteGroupManager: deleting group:', groupName)
    const email = this.buildEmail(groupName)
    return this.connection.groups.delete({groupKey: email}).catch(e => this.error(e))
  }

  async getGroups() {
    return this.connection.groups.list({domain: this.domain})
      .then(response => response.data.groups)
      .catch(e => this.error(e))
  }

  async insertUser(email, groupName) {
    console.info(`Adding '${email}' to the '${groupName}' GSuite group`)
    return this.connection.members.insert({
      groupKey: this.buildEmail(groupName),
      requestBody: {email},
    })
  }

  buildEmail(groupName) {
    return `${groupName}@${this.domain}`
  }

  error(e) { // eslint-disable-line class-methods-use-this
    console.log(e)
    throw e
  }
}

module.exports = {GroupManager}
