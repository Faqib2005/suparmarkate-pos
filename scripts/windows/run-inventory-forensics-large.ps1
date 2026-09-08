param(
  [Parameter(Mandatory = $true)]
  [string]$BackupFile,
  [string]$UploadsPath,
  [string]$ComplaintProducts = "",
  [ValidateRange(1, 50)]
  [int]$Concurrency = 10,
  [string]$CloneDatabaseName = "customer_scale_clone_supermarket_test",
  [string]$OutputDirectory = "",
  [string]$RepoRoot = ""
)

$ErrorActionPreference = "Stop"

$previous = @{
  ProductCount = $env:STOCK_STRESS_PRODUCT_COUNT
  OperationsPerProduct = $env:STOCK_STRESS_OPERATIONS_PER_PRODUCT
  ProductConcurrency = $env:STOCK_STRESS_PRODUCT_CONCURRENCY
  TestTimeout = $env:STOCK_STRESS_TEST_TIMEOUT_MS
  ComplaintProducts = $env:STOCK_STRESS_COMPLAINT_PRODUCTS
}

try {
  $env:STOCK_STRESS_PRODUCT_COUNT = "1000"
  $env:STOCK_STRESS_OPERATIONS_PER_PRODUCT = "500"
  $env:STOCK_STRESS_PRODUCT_CONCURRENCY = $Concurrency.ToString()
  $env:STOCK_STRESS_TEST_TIMEOUT_MS = (8 * 60 * 60 * 1000).ToString()
  $env:STOCK_STRESS_COMPLAINT_PRODUCTS = $ComplaintProducts

  $runner = Join-Path $PSScriptRoot "run-inventory-forensics.ps1"
  $runnerArguments = @{
    BackupFile = $BackupFile
    CloneDatabaseName = $CloneDatabaseName
  }
  if (-not [string]::IsNullOrWhiteSpace($UploadsPath)) {
    $runnerArguments.UploadsPath = $UploadsPath
  }
  if (-not [string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $runnerArguments.OutputDirectory = $OutputDirectory
  }
  if (-not [string]::IsNullOrWhiteSpace($RepoRoot)) {
    $runnerArguments.RepoRoot = $RepoRoot
  }

  Write-Host "Prepared scale: 1000 products x 500 operations (500,000 operations)."
  Write-Host "Concurrency: $Concurrency; timeout: 8 hours; clone: $CloneDatabaseName"
  & $runner @runnerArguments
  if ($LASTEXITCODE -ne 0) {
    throw "Large inventory forensic run failed with exit code $LASTEXITCODE."
  }
} finally {
  $env:STOCK_STRESS_PRODUCT_COUNT = $previous.ProductCount
  $env:STOCK_STRESS_OPERATIONS_PER_PRODUCT = $previous.OperationsPerProduct
  $env:STOCK_STRESS_PRODUCT_CONCURRENCY = $previous.ProductConcurrency
  $env:STOCK_STRESS_TEST_TIMEOUT_MS = $previous.TestTimeout
  $env:STOCK_STRESS_COMPLAINT_PRODUCTS = $previous.ComplaintProducts
}
