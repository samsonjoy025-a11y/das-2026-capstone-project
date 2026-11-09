/* global Scalar */
if (window.Scalar && typeof Scalar.createApiReference === 'function') {
  Scalar.createApiReference('#app', {
    url: '/openapi.json',
    authentication: { preferredSecurityScheme: 'BearerAuth' },
  });
}
