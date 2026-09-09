// Singleton Temporal Client. Connection is established lazily on first use
// and closed explicitly on server shutdown.
import { Client, Connection } from '@temporalio/client';
import type { Config } from './config';

let connection: Connection | undefined;
let client: Client | undefined;

export async function getTemporalClient(config: Config): Promise<Client> {
  if (client) return client;

  connection = await Connection.connect({ address: config.temporalAddress });
  client = new Client({ connection, namespace: config.temporalNamespace });
  return client;
}

export async function closeTemporalClient(): Promise<void> {
  if (connection) {
    await connection.close();
    connection = undefined;
    client = undefined;
  }
}
