export type AnythingLLMConfig = {
  serviceAuthMode: 'gcp' | 'local_jwt';
  serviceAudience: string;
  baseUrl: string;
  enableDelegatedTokens: boolean;
  delegatedTokenSecret: string;
  delegatedTokenExpiresIn: number;
  delegatedTokenAudience: string;
};
