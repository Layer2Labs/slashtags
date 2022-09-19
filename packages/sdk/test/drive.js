import test from 'brittle'
import createTestnet from '@hyperswarm/testnet'
import c from 'compact-encoding'
import b4a from 'b4a'

import SDK from '../index.js'
import { tmpdir } from './helpers/index.js'

test('drive - resolve public drive', async (t) => {
  const testnet = await createTestnet(3, t.teardown)
  const sdk = new SDK({ ...testnet, storage: tmpdir() })

  const alice = sdk.slashtag('alice')
  const drive = alice.drivestore.get()
  await sdk.swarm.flush()

  const profile = { name: 'alice' }
  await drive.put('/profile.json', c.encode(c.json, profile))

  // other side
  const remote = new SDK({ ...testnet, storage: tmpdir() })
  const clone = remote.drive(drive.key)

  const buf = await clone.get('/profile.json')
  const resolved = buf && c.decode(c.json, buf)

  t.alike(resolved, profile)

  await sdk.close()
  await remote.close()
})

test('drive - blind seeder resolve private drive', async (t) => {
  const testnet = await createTestnet(3, t.teardown)
  const sdk = new SDK({ ...testnet, storage: tmpdir() })

  const alice = sdk.slashtag('alice')
  const publicDrive = alice.drivestore.get()

  const drive = alice.drivestore.get('contacts')
  await sdk.swarm.flush()

  const contact = { name: 'alice' }
  await drive.put('/foo', c.encode(c.json, contact))

  // other side
  const seeder = new SDK({ ...testnet, storage: tmpdir() })

  const clone = seeder.drive(drive.key)

  seeder.join(publicDrive.discoveryKey)

  await t.exception(clone.get('/foo'), /.*/, "blind seeder can't reed private drive")
  t.is(clone.core.length, 2, 'still can replicate')

  await sdk.close()

  await sdk.close()
  await seeder.close()
})

test('drive - internal hyperdrive', async (t) => {
  const testnet = await createTestnet(3, t.teardown)
  const sdk = new SDK({ ...testnet, storage: tmpdir() })

  const alice = sdk.slashtag('alice')
  const drive = alice.drivestore.get()

  const profile = { name: 'alice' }
  await drive.put('/profile.json', c.encode(c.json, profile))

  const readonly = sdk.drive(alice.key)

  t.alike(
    await readonly.get('/profile.json')
      .then(buf => buf && c.decode(c.json, buf)),
    profile,
    'correctly open a readonly drive session of local drive'
  )

  const discovery = sdk.swarm._discovery.get(b4a.toString(drive.discoveryKey, 'hex'))
  // @ts-ignore
  t.is(discovery._sessions.length, 1)
  t.is(discovery?._clientSessions, 1)
  t.is(discovery?._serverSessions, 1)
  t.ok(discovery?.isClient)
  t.ok(discovery?.isServer)

  await sdk.close()
})

test('drive - no unnecessary discovery sessions', async (t) => {
  const testnet = await createTestnet(3, t.teardown)

  const sdk = new SDK({ ...testnet, storage: tmpdir() })
  const alice = sdk.slashtag('alice')
  const drive = alice.drivestore.get()
  await sdk.swarm.flush()

  const remote = new SDK({ ...testnet, storage: tmpdir() })
  const clone = remote.drive(drive.key)
  await clone.ready()

  for (let i = 0; i < 10; i++) {
    await remote.drive(alice.key).ready()
  }

  // @ts-ignore
  t.is(remote.corestore._findingPeersCount, 1)

  await remote.swarm.flush()

  // @ts-ignore
  t.is(remote.corestore._findingPeersCount, 0)

  const discovery = remote.swarm._discovery.get(b4a.toString(drive.discoveryKey, 'hex'))
  // @ts-ignore
  t.is(discovery._sessions.length, 1)
  t.is(discovery?._clientSessions, 1)
  t.is(discovery?._serverSessions, 0)
  t.ok(discovery?.isClient)
  t.absent(discovery?.isServer)

  await remote.close()
  await sdk.close()
})

test('read only created first', async (t) => {
  const testnet = await createTestnet(3, t.teardown)
  const dir = tmpdir()
  let key
  let primaryKey

  {
    const sdk = new SDK({ ...testnet, storage: dir })
    const alice = sdk.slashtag()
    const writable = alice.drivestore.get()
    await writable.put('/profile.json', b4a.from(''))
    key = writable.key
    primaryKey = sdk.primaryKey

    await sdk.close()
    // TODO move this to sdk.close?
    await sdk.corestore.close()
  }

  const sdk = new SDK({ ...testnet, storage: dir, primaryKey })
  const readable = sdk.drive(key)
  await readable.ready()

  const writable = sdk.slashtag().drivestore.get()
  await writable.ready()
  t.ok(await writable.get('/profile.json'))

  t.alike(writable.key, readable.key)
  t.alike(await readable.get('/profile.json'), await writable.get('/profile.json'))

  await sdk.close()
})

test('replicate on closed corestore', async (t) => {
  const testnet = await createTestnet(3, t.teardown)
  const sdk = new SDK({ ...testnet, storage: tmpdir() })

  const alice = sdk.slashtag('alice')
  const drive = alice.drivestore.get()
  await sdk.swarm.flush()

  const profile = { name: 'alice' }
  await drive.put('/profile.json', c.encode(c.json, profile))

  // other side
  const remote = new SDK({ ...testnet, storage: tmpdir() })
  const clone = remote.drive(drive.key)

  remote.close()

  await t.exception(() => clone.get('/profile.json'), /The corestore is closed/)
  await clone.get('/profile.json').catch(noop)
  t.pass('catch caught error on clone.get()')

  await sdk.close()
  await remote.close()
})

test('replicate after swarm destroyed', async (t) => {
  const testnet = await createTestnet(3, t.teardown)
  const sdk = new SDK({ ...testnet, storage: tmpdir() })

  const alice = sdk.slashtag('alice')
  const drive = alice.drivestore.get()
  await sdk.swarm.flush()

  const profile = { name: 'alice' }
  await drive.put('/profile.json', c.encode(c.json, profile))

  // other side
  const remote = new SDK({ ...testnet, storage: tmpdir() })
  const clone = remote.drive(drive.key)

  await remote.close()

  await t.exception(() => clone.get('/profile.json'))
  await clone.get('/profile.json').catch(noop)
  t.pass('catch caught error on clone.get()')

  await sdk.close()
  await remote.close()
})

test('swarm destroying before creating a drive', async (t) => {
  const testnet = await createTestnet(3, t.teardown)
  const sdk = new SDK({ ...testnet, storage: tmpdir() })

  const alice = sdk.slashtag('alice')
  const drive = alice.drivestore.get()
  await sdk.swarm.flush()

  const profile = { name: 'alice' }
  await drive.put('/profile.json', c.encode(c.json, profile))

  // other side
  const dir = tmpdir()
  const remote = new SDK({ ...testnet, storage: dir })
  {
    const clone = remote.drive(drive.key)
    await clone.ready()

    const buf = await clone.get('/profile.json')
    const resolved = buf && c.decode(c.json, buf)

    t.alike(resolved, profile)
  }

  remote.swarm.destroy()

  {
    const clone = remote.drive(drive.key)
    await clone.ready()

    const buf = await clone.get('/profile.json')
    const resolved = buf && c.decode(c.json, buf)

    t.alike(resolved, profile)
  }

  t.pass('should not hang forever')

  await sdk.close()
  await remote.close()
})

function noop () {}
