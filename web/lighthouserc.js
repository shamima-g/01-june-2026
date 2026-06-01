module.exports = {
  ci: {
    collect: {
      // Override with LIGHTHOUSE_TARGET_URL to audit a staging deployment
      // instead of the locally-built production bundle (e.g. when you have a
      // real backend). Project-local convention — not an @lhci/cli built-in.
      url: [process.env.LIGHTHOUSE_TARGET_URL || 'http://localhost:3000/'],
      numberOfRuns: 3,
      settings: {
        preset: 'desktop',
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.8 }],
        'categories:accessibility': ['error', { minScore: 0.9 }],
        'categories:best-practices': ['error', { minScore: 0.8 }],
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
};
