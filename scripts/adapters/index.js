/**
 * PRAFLIX — Provider Adapter Factory & Registry Integration
 * A PRAVERSE Company
 */

const providerRegistry = require('../provider_registry');
const HDHub4uAdapter = require('./hdhub4u_adapter');
const TenMoviezAdapter = require('./10moviez_adapter');
const HDWallAdapter = require('./hdwall_adapter');

const adapterClasses = {
  'hdhub4u': HDHub4uAdapter,
  '10moviez': TenMoviezAdapter,
  'hdwall': HDWallAdapter
};

/**
 * Register a custom adapter class for a provider
 */
function registerAdapterClass(providerId, adapterClass) {
  adapterClasses[String(providerId).toLowerCase().trim()] = adapterClass;
}

/**
 * Get an instantiated adapter for a given provider
 */
function getAdapter(providerIdentifier) {
  const provider = providerRegistry.getProvider(providerIdentifier);
  if (!provider) {
    throw new Error(`Cannot create adapter: Unknown provider "${providerIdentifier}".`);
  }

  const AdapterClass = adapterClasses[provider.id] || HDHub4uAdapter;
  return new AdapterClass(provider);
}

module.exports = {
  getAdapter,
  registerAdapterClass,
  HDHub4uAdapter,
  TenMoviezAdapter,
  HDWallAdapter
};
