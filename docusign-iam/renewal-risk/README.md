# Docusign IAM Renewal Risk Project

This IAM Toolkit project configures Docusign Agreement Manager for the supplier
renewal-risk demo.

The app uses Docusign MCP at runtime. This IAM project is the sandbox setup path
for creating the custom agreement type and validating extraction quality before
the app queries Agreement Manager through MCP.

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
