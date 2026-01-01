export type AnythingLLMConfig = {
  serviceAuthMode: 'gcp' | 'local_jwt';
  serviceAudience: string;
  baseUrl: string;
};
