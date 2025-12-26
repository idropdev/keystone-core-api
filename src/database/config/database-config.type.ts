export type DatabaseConfig = {
  isDocumentDatabase: boolean;
  url?: string;
  type?: string;
  host?: string;
  port?: number;
  password?: string;
  name?: string;
  username?: string;
  synchronize?: boolean;
  maxConnections: number;
  sslEnabled?: boolean;
  rejectUnauthorized?: boolean;
  ca?: string;
  key?: string;
  cert?: string;
  // Logging configuration
  // Can be: false | true | 'all' | ['query', 'error', 'schema', 'warn', 'info', 'log'] | 'simple' | 'advanced'
  // false = no logging, true = all logging, 'all' = all logging, array = specific log types
  logging?: boolean | 'all' | ('query' | 'error' | 'schema' | 'warn' | 'info' | 'log')[] | 'simple' | 'advanced';
};
