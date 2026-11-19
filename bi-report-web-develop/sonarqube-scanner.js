const scanner = require('sonarqube-scanner');

scanner(
  {
    serverUrl: 'https://codequality.synergymarinetest.com',
    token: 'eb3e2f4d592c2729153d010775ea7a6c02a59b70',
    options: {
      'sonar.projectKey': 'Synergy-Marine-Group_ccd-web',
      'sonar.sources': './src'
    }
  },
  () => process.exit()
);
