// Mocha reporter: human-readable spec output on stdout AND JUnit XML in a file
// (set with --reporter-option output=<file>).
const Mocha = require('mocha');
module.exports = function (runner, options) {
    Mocha.reporters.Base.call(this, runner, options);
    new Mocha.reporters.Spec(runner, options);
    new Mocha.reporters.XUnit(runner, options);
};
