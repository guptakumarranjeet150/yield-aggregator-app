import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { IndexerDatabase, ContractEvent } from '../src/db/database';

async function runTests() {
  console.log('Running SQLite Event Indexer Storage Tests...\n');

  // Test 1: In-memory initialization and schema seeding
  console.log('Test 1: In-memory initialization and schema seeding');
  const memDb = new IndexerDatabase(':memory:');
  const initialEvents = memDb.getEvents();
  assert.strictEqual(initialEvents.length, 3, 'Should seed 3 default events');
  const usdcVault = memDb.getVault('vault-usdc');
  assert.ok(usdcVault, 'Should seed vault-usdc');
  assert.strictEqual(usdcVault?.name, 'Soroban USDC Yield Vault');
  console.log('✓ Passed: In-memory database initialized with default seeded records.\n');

  // Test 2: Event insertion and retrieval
  console.log('Test 2: Event insertion and retrieval');
  const testEvent: ContractEvent = {
    id: 'evt_test_999',
    contractId: 'CD...CUSTOM_VAULT',
    type: 'Deposit',
    user: 'GD...TEST_USER',
    amount: '7500.50',
    timestamp: new Date().toISOString(),
  };
  memDb.insertEvent(testEvent);
  const retrievedEvent = memDb.getEventById('evt_test_999');
  assert.ok(retrievedEvent, 'Should find inserted event by ID');
  assert.strictEqual(retrievedEvent?.amount, '7500.50');
  assert.strictEqual(retrievedEvent?.contractId, 'CD...CUSTOM_VAULT');

  // Test 3: Contract ID filtering
  console.log('Test 3: Contract ID filtering');
  const filteredEvents = memDb.getEvents('CD...CUSTOM_VAULT');
  assert.strictEqual(filteredEvents.length, 1, 'Should return only 1 matching event');
  assert.strictEqual(filteredEvents[0].id, 'evt_test_999');

  const defaultEvents = memDb.getEvents('CD...USDC_VAULT');
  assert.strictEqual(defaultEvents.length, 3, 'Should return 3 USDC vault events');
  console.log('✓ Passed: Event insertion and filtering by contractId operate correctly.\n');

  // Test 4: TVL updates on Vault
  console.log('Test 4: TVL updates on Vault');
  const vaultBefore = memDb.getVault('vault-usdc')!;
  const tvlBefore = vaultBefore.tvl;
  memDb.updateVaultTvl('vault-usdc', 5000);
  const vaultAfterDeposit = memDb.getVault('vault-usdc')!;
  assert.strictEqual(vaultAfterDeposit.tvl, tvlBefore + 5000, 'TVL should increase by 5000 on deposit');

  memDb.updateVaultTvl('vault-usdc', -2000);
  const vaultAfterWithdrawal = memDb.getVault('vault-usdc')!;
  assert.strictEqual(vaultAfterWithdrawal.tvl, tvlBefore + 3000, 'TVL should reflect withdrawal decrease');
  console.log('✓ Passed: Vault TVL updates accurately reflect deposits and withdrawals.\n');

  memDb.close();

  // Test 5: Persistence across server restarts (Disk-backed database)
  console.log('Test 5: Persistence across server restarts (Disk DB)');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yield-indexer-test-'));
  const dbFile = path.join(tmpDir, 'indexer_persistence.db');

  // First session: open DB, insert event, close DB
  const session1Db = new IndexerDatabase(dbFile);
  const persistentEvent: ContractEvent = {
    id: 'evt_persisted_101',
    contractId: 'CD...PERSISTENT_VAULT',
    type: 'StrategyAllocated',
    user: 'GD...ADMIN_PERSIST',
    amount: '12345.00',
    timestamp: new Date().toISOString(),
  };
  session1Db.insertEvent(persistentEvent);
  session1Db.updateVaultTvl('vault-usdc', 9999);
  session1Db.close();

  // Second session (simulating server reboot): reopen same DB file
  const session2Db = new IndexerDatabase(dbFile);
  const fetchedAfterReboot = session2Db.getEventById('evt_persisted_101');
  assert.ok(fetchedAfterReboot, 'Event must persist across database re-open/server restart');
  assert.strictEqual(fetchedAfterReboot?.amount, '12345.00');

  const vaultAfterReboot = session2Db.getVault('vault-usdc');
  assert.ok(vaultAfterReboot, 'Vault state must persist across restart');
  assert.strictEqual(vaultAfterReboot?.tvl, 1250000 + 9999, 'Persisted TVL must reflect prior updates');

  session2Db.close();

  // Cleanup temporary test directory
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('✓ Passed: Event and vault state successfully persisted across server restart.\n');

  console.log('All SQLite database storage tests passed successfully! (5/5)');
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
