// Example stack-shared-ai plugin.
// Adds a cross-stack scanner that emits a file-count footer.
module.exports = {
  name: "sample-footer-plugin",
  crossStack: [
    {
      name: "footer",
      async scan(allResults, frameworks, _options) {
        return {
          filename: "footer.md",
          content: `# Footer\n\nGenerated ${allResults.length} files for frameworks: ${frameworks.join(", ")}.\n`,
        };
      },
    },
  ],
};
