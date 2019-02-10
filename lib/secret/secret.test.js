const {Secret} = require('./secret')
const {Firestore, CollectionReference, DocumentReference, DocumentSnapshot} = require('@google-cloud/firestore')

// TODO: convert to Jest manual mock file (maybe?)
jest.mock('@google-cloud/firestore')
const firestore = new Firestore()
const collection = new CollectionReference()
const doc = new DocumentReference()
const snapshot = new DocumentSnapshot()
const data = {'secret': 'no secrets here'}

beforeEach(() => {
  jest.restoreAllMocks()
  jest.spyOn(firestore, 'collection').mockReturnValue(collection)
  jest.spyOn(collection, 'doc').mockReturnValue(doc)
  jest.spyOn(doc, 'get').mockResolvedValue(snapshot)
  jest.spyOn(snapshot, 'data').mockReturnValue(data)
});

describe('Secret class', () => {
  function secret() {
    const s = new Secret('testKey')
    // why do I need this?
    jest.spyOn(s, 'connection', 'get').mockReturnValue(firestore)
    return s
  }

  // TODO:
  // it validates secretName in the constructor
  // it validates secretValue in set

  // XXX - this should probably go away - we don't really care
  it('builds a Google Firestore collection', () => {
    expect(secret().collection.constructor.name).toEqual('CollectionReference')
  })

  // XXX - this should probably go away - we don't really care
  it('builds a Google Firestore document', () => {
    expect(secret().doc.constructor.name).toEqual('DocumentReference')
  })

  it('can retrieve the value of a secret', async () => {
    jest.spyOn(snapshot, 'data').mockReturnValue({'secret': 'this is a secret'})
    await expect(secret().get()).resolves.toEqual('this is a secret')
  })

  it('can retrieve the original value of a secret', async () => {
    await expect(secret().get()).resolves.toEqual('no secrets here')
  })
})
