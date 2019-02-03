class Member {
  constructor(memberJson) {
    this.json = memberJson
  }

  get email() {
    return this.json.email_address
  }

  get tags() {
    return this.json.tags
  }
}

module.exports = {Member}
