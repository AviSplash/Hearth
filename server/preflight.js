// Imported first by index.js so an old Node.js gets a clear message instead
// of a confusing crash. (Ubuntu's own apt package is too old on 22.04/24.04.)

const [major] = process.versions.node.split('.').map(Number);
if (major < 20) {
  const hints = {
    linux: 'Run ./install.sh to install a current Node.js, or see https://nodejs.org/en/download',
    darwin: 'Install it with "brew install node" or from https://nodejs.org, then try again.',
    win32: 'Download the LTS installer from https://nodejs.org, then try again.',
  };
  console.error(`\n  Hearth needs Node.js 20 or newer, but this is Node.js ${process.versions.node}.`);
  console.error(`  ${hints[process.platform] || hints.linux}\n`);
  process.exit(1);
}
