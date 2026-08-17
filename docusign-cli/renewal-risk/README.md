# Docusign CLI Renewal Risk Workspace

This Docusign CLI workspace configures Docusign Agreement Manager for the supplier
renewal-risk demo.

The app uses Docusign MCP at runtime. This CLI workspace is the sandbox setup
path for creating the custom agreement type and validating extraction quality
before the app queries Agreement Manager through MCP.

Install Docusign CLI from the `@docusign/cli` npm package
(`npm install -g @docusign/cli`) and authenticate it with `ds auth login`, which
uses PKCE. That CLI authentication is separate from the app's
`npm run auth:docusign` Docusign MCP OAuth helper.

## Structure

```text
renewal-risk/
  agreement-manager/
    configs/agreement-manager-manifest.json
    files/train/
    files/test/
    tests/testing.csv
```

See `agreement-manager/README.md` for the setup and validation commands.
