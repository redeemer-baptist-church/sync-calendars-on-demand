const ow = require('ow')
const {Firestore} = require('@google-cloud/firestore')

class Secret {
  constructor(secretName) {
    ow(secretName, ow.string)
    this.secretName = secretName
  }

  async get() {
    return this.doc.get().then(snapshot => snapshot.data().secret)
  }

  async set(secretValue) {
    ow(secretValue, ow.string)
    return this.doc.set({
      secret: secretValue,
    })
  }

  get doc() {
    return this.collection.doc(this.secretName)
  }

  get collection() {
    return this._collection || this.buildCollection()
  }

  buildCollection() {
    this._collection = this.connection.collection('secrets')
    return this._collection
  }

  get connection() {
    return this._connection || this.buildDatabaseConnection()
  }

  buildDatabaseConnection() {
    this._connection = new Firestore()
    return this._connection
  }
}

module.exports = {Secret}
