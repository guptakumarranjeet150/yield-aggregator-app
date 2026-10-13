import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export interface VaultState {
  id: string;
  name: string;
  token: string;
  tvl: number;
  apy: number;
  allocations: {
    strategyA: number; // Percentage
    strategyB: number;
    strategyC: number;
  };
}

export interface ContractEvent {
  id: string;
  contractId: string;
  type: 'Deposit' | 'WithdrawalInitiated' | 'WithdrawalClaimed' | 'StrategyAllocated' | 'Paused' | 'Unpaused';
  user: string;
  amount: string;
  timestamp: string;
}

interface EventRow {
  id: string;
  contract_id: string;
  type: string;
  user: string;
  amount: string;
  timestamp: string;
}

interface VaultRow {
  id: string;
  name: string;
  token: string;
  tvl: number;
  apy: number;
  allocations_json: string;
}

export class IndexerDatabase {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const finalPath = dbPath || process.env.DB_PATH || path.join(process.cwd(), 'data', 'indexer.db');
    if (finalPath !== ':memory:') {
      const dir = path.dirname(finalPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    this.db = new Database(finalPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
    this.seedIfEmpty();
  }

  private initSchema(): void {
    const schemaSql = `
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL,
        type TEXT NOT NULL,
        user TEXT NOT NULL,
        amount TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_events_contract_id ON events (contract_id);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events (type);
      CREATE INDEX IF NOT EXISTS idx_events_user ON events (user);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events (timestamp);

      CREATE TABLE IF NOT EXISTS vaults (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token TEXT NOT NULL,
        tvl REAL NOT NULL,
        apy REAL NOT NULL,
        allocations_json TEXT NOT NULL
      );
    `;
    this.db.exec(schemaSql);
  }

  private seedIfEmpty(): void {
    const eventCount = (this.db.prepare('SELECT COUNT(*) as count FROM events').get() as { count: number }).count;
    if (eventCount === 0) {
      const insertEvent = this.db.prepare(`
        INSERT INTO events (id, contract_id, type, user, amount, timestamp)
        VALUES (@id, @contract_id, @type, @user, @amount, @timestamp)
      `);

      const defaultEvents: EventRow[] = [
        {
          id: 'evt_001',
          contract_id: 'CD...USDC_VAULT',
          type: 'Deposit',
          user: 'GD...USER_A',
          amount: '1000.00',
          timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
        },
        {
          id: 'evt_002',
          contract_id: 'CD...USDC_VAULT',
          type: 'StrategyAllocated',
          user: 'GD...ADMIN',
          amount: '500.00',
          timestamp: new Date(Date.now() - 3600000).toISOString(),
        },
        {
          id: 'evt_003',
          contract_id: 'CD...USDC_VAULT',
          type: 'WithdrawalInitiated',
          user: 'GD...USER_B',
          amount: '200.00',
          timestamp: new Date().toISOString(),
        },
      ];

      const seedEventsTx = this.db.transaction((rows: EventRow[]) => {
        for (const row of rows) {
          insertEvent.run(row);
        }
      });
      seedEventsTx(defaultEvents);
    }

    const vaultCount = (this.db.prepare('SELECT COUNT(*) as count FROM vaults').get() as { count: number }).count;
    if (vaultCount === 0) {
      const insertVault = this.db.prepare(`
        INSERT INTO vaults (id, name, token, tvl, apy, allocations_json)
        VALUES (@id, @name, @token, @tvl, @apy, @allocations_json)
      `);

      const defaultVaults: VaultRow[] = [
        {
          id: 'vault-usdc',
          name: 'Soroban USDC Yield Vault',
          token: 'USDC:GA5ZSEAEWZ2AQF0OB5A7B9FEB9342544EFQ22',
          tvl: 1250000,
          apy: 8.45,
          allocations_json: JSON.stringify({ strategyA: 50, strategyB: 30, strategyC: 20 }),
        },
        {
          id: 'vault-xlm',
          name: 'Soroban XLM Yield Vault',
          token: 'XLM',
          tvl: 4500000,
          apy: 4.12,
          allocations_json: JSON.stringify({ strategyA: 70, strategyB: 30, strategyC: 0 }),
        },
      ];

      const seedVaultsTx = this.db.transaction((rows: VaultRow[]) => {
        for (const row of rows) {
          insertVault.run(row);
        }
      });
      seedVaultsTx(defaultVaults);
    }
  }

  public getEvents(contractId?: string): ContractEvent[] {
    let rows: EventRow[];
    if (contractId) {
      rows = this.db
        .prepare('SELECT id, contract_id, type, user, amount, timestamp FROM events WHERE contract_id = ? ORDER BY timestamp DESC')
        .all(contractId) as EventRow[];
    } else {
      rows = this.db
        .prepare('SELECT id, contract_id, type, user, amount, timestamp FROM events ORDER BY timestamp DESC')
        .all() as EventRow[];
    }

    return rows.map((r) => ({
      id: r.id,
      contractId: r.contract_id,
      type: r.type as ContractEvent['type'],
      user: r.user,
      amount: r.amount,
      timestamp: r.timestamp,
    }));
  }

  public getEventById(id: string): ContractEvent | undefined {
    const row = this.db
      .prepare('SELECT id, contract_id, type, user, amount, timestamp FROM events WHERE id = ?')
      .get(id) as EventRow | undefined;

    if (!row) return undefined;
    return {
      id: row.id,
      contractId: row.contract_id,
      type: row.type as ContractEvent['type'],
      user: row.user,
      amount: row.amount,
      timestamp: row.timestamp,
    };
  }

  public insertEvent(event: ContractEvent): ContractEvent {
    this.db
      .prepare(`
        INSERT INTO events (id, contract_id, type, user, amount, timestamp)
        VALUES (@id, @contract_id, @type, @user, @amount, @timestamp)
      `)
      .run({
        id: event.id,
        contract_id: event.contractId,
        type: event.type,
        user: event.user,
        amount: event.amount,
        timestamp: event.timestamp,
      });

    return event;
  }

  public getVault(id: string): VaultState | undefined {
    const row = this.db
      .prepare('SELECT id, name, token, tvl, apy, allocations_json FROM vaults WHERE id = ?')
      .get(id) as VaultRow | undefined;

    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      token: row.token,
      tvl: row.tvl,
      apy: row.apy,
      allocations: JSON.parse(row.allocations_json),
    };
  }

  public getAllVaults(): VaultState[] {
    const rows = this.db
      .prepare('SELECT id, name, token, tvl, apy, allocations_json FROM vaults')
      .all() as VaultRow[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      token: row.token,
      tvl: row.tvl,
      apy: row.apy,
      allocations: JSON.parse(row.allocations_json),
    }));
  }

  public updateVaultTvl(id: string, tvlDelta: number): VaultState | undefined {
    const vault = this.getVault(id);
    if (!vault) return undefined;

    const newTvl = vault.tvl + tvlDelta;
    this.db.prepare('UPDATE vaults SET tvl = ? WHERE id = ?').run(newTvl, id);
    vault.tvl = newTvl;
    return vault;
  }

  public close(): void {
    this.db.close();
  }
}

// Global instance
export const defaultDb = new IndexerDatabase();
