/* eslint-disable eol-last */
/* eslint-disable no-multiple-empty-lines */
/* eslint-disable max-len */

/** Microsoft Entra ID — Synergy tenant only */
export const AzureADConfigConstants = {
  authority: process.env.REACT_APP_AD_AUTH_URL,
  client_id: process.env.REACT_APP_AD_CLIENT_ID,
  redirect_uri: process.env.REACT_APP_AD_REDIRECT_URL,
  automaticSilentRenew: true,
  silent_redirect_uri: process.env.REACT_APP_AD_SILENT_REDIRECT_URL,
  post_logout_redirect_uri: process.env.REACT_APP_AD_LOGOFF_REDIRECT_URL,
  response_type: 'code',
  triggerAuthFlow: true,
  includeIdTokenInSilentRenew: false,
  grantTypes: 'authorization_code',
  scope: process.env.REACT_APP_AD_SCOPE,
  extraQueryParams: { domain_hint: 'synergyship.com' },
};

export const ProvideName = {
  AzureAD: 'AzureAD',
};
