/*
  MyLife Phase 2 — one-time legacy backfill and tenant finalization.
  Review and run manually only on an approved local/staging database copy.
  Replace the placeholder with the User.id obtained locally after Google login.
  This script intentionally has no email-based ownership/bootstrap behavior.
*/
SET XACT_ABORT ON;
DECLARE @OwnerUserId NVARCHAR(30) = N'REPLACE_WITH_USER_ID';

IF @OwnerUserId = N'REPLACE_WITH_USER_ID' OR LEN(@OwnerUserId) = 0
    THROW 51000, 'Set @OwnerUserId to the verified internal User.id before running this script.', 1;

BEGIN TRY
    BEGIN TRANSACTION;

    IF NOT EXISTS (SELECT 1 FROM [dbo].[User] WHERE [id] = @OwnerUserId)
        THROW 51001, 'The supplied User.id does not exist.', 1;

    IF EXISTS (SELECT 1 FROM [dbo].[TenantBackfillControl] WHERE [id] = N'legacy-personal-v1')
        THROW 51002, 'The legacy backfill has already been completed; refusing to run twice.', 1;

    DECLARE @PersonalSpaceId NVARCHAR(30);
    DECLARE @PersonalCount INT;
    SELECT @PersonalCount = COUNT(*), @PersonalSpaceId = MIN(s.[id])
    FROM [dbo].[Space] AS s
    INNER JOIN [dbo].[Membership] AS m ON m.[spaceId] = s.[id]
    WHERE s.[type] = N'PERSONAL'
      AND m.[userId] = @OwnerUserId
      AND m.[status] = N'ACTIVE';

    IF @PersonalCount <> 1 OR @PersonalSpaceId IS NULL
        THROW 51003, 'The verified user must have exactly one active Personal space.', 1;

    IF EXISTS (SELECT 1 FROM [dbo].[Space] WHERE [id] = @PersonalSpaceId AND [name] <> N'Personal')
        THROW 51004, 'The target space is not the expected Personal space.', 1;

    IF EXISTS (SELECT 1 FROM [dbo].[Category] WHERE [spaceId] IS NOT NULL AND [spaceId] <> @PersonalSpaceId)
       OR EXISTS (SELECT 1 FROM [dbo].[FinancialEntry] WHERE [spaceId] IS NOT NULL AND [spaceId] <> @PersonalSpaceId)
       OR EXISTS (SELECT 1 FROM [dbo].[RecurringRule] WHERE [spaceId] IS NOT NULL AND [spaceId] <> @PersonalSpaceId)
       OR EXISTS (SELECT 1 FROM [dbo].[Budget] WHERE [spaceId] IS NOT NULL AND [spaceId] <> @PersonalSpaceId)
       OR EXISTS (SELECT 1 FROM [dbo].[Supermarket] WHERE [spaceId] IS NOT NULL AND [spaceId] <> @PersonalSpaceId)
       OR EXISTS (SELECT 1 FROM [dbo].[ShoppingProduct] WHERE [spaceId] IS NOT NULL AND [spaceId] <> @PersonalSpaceId)
       OR EXISTS (SELECT 1 FROM [dbo].[ShoppingVariant] WHERE [spaceId] IS NOT NULL AND [spaceId] <> @PersonalSpaceId)
       OR EXISTS (SELECT 1 FROM [dbo].[ShoppingReceipt] WHERE [spaceId] IS NOT NULL AND [spaceId] <> @PersonalSpaceId)
       OR EXISTS (SELECT 1 FROM [dbo].[ShoppingReceiptItem] WHERE [spaceId] IS NOT NULL AND [spaceId] <> @PersonalSpaceId)
       OR EXISTS (SELECT 1 FROM [dbo].[ShoppingListItem] WHERE [spaceId] IS NOT NULL AND [spaceId] <> @PersonalSpaceId)
        THROW 51005, 'Found tenant rows assigned to another space; review the database before continuing.', 1;

    DECLARE @CategoryCount BIGINT = (SELECT COUNT_BIG(*) FROM [dbo].[Category]);
    DECLARE @EntryCount BIGINT = (SELECT COUNT_BIG(*) FROM [dbo].[FinancialEntry]);
    DECLARE @RuleCount BIGINT = (SELECT COUNT_BIG(*) FROM [dbo].[RecurringRule]);
    DECLARE @BudgetCount BIGINT = (SELECT COUNT_BIG(*) FROM [dbo].[Budget]);
    DECLARE @SupermarketCount BIGINT = (SELECT COUNT_BIG(*) FROM [dbo].[Supermarket]);
    DECLARE @ProductCount BIGINT = (SELECT COUNT_BIG(*) FROM [dbo].[ShoppingProduct]);
    DECLARE @VariantCount BIGINT = (SELECT COUNT_BIG(*) FROM [dbo].[ShoppingVariant]);
    DECLARE @ReceiptCount BIGINT = (SELECT COUNT_BIG(*) FROM [dbo].[ShoppingReceipt]);
    DECLARE @ReceiptItemCount BIGINT = (SELECT COUNT_BIG(*) FROM [dbo].[ShoppingReceiptItem]);
    DECLARE @ListItemCount BIGINT = (SELECT COUNT_BIG(*) FROM [dbo].[ShoppingListItem]);

    UPDATE [dbo].[Category] SET [spaceId] = @PersonalSpaceId WHERE [spaceId] IS NULL;
    UPDATE [dbo].[FinancialEntry] SET [spaceId] = @PersonalSpaceId WHERE [spaceId] IS NULL;
    UPDATE [dbo].[RecurringRule] SET [spaceId] = @PersonalSpaceId WHERE [spaceId] IS NULL;
    UPDATE [dbo].[Budget] SET [spaceId] = @PersonalSpaceId WHERE [spaceId] IS NULL;
    UPDATE [dbo].[Supermarket] SET [spaceId] = @PersonalSpaceId WHERE [spaceId] IS NULL;
    UPDATE [dbo].[ShoppingProduct] SET [spaceId] = @PersonalSpaceId WHERE [spaceId] IS NULL;
    UPDATE [dbo].[ShoppingVariant] SET [spaceId] = @PersonalSpaceId WHERE [spaceId] IS NULL;
    UPDATE [dbo].[ShoppingReceipt] SET [spaceId] = @PersonalSpaceId WHERE [spaceId] IS NULL;
    UPDATE [dbo].[ShoppingReceiptItem] SET [spaceId] = @PersonalSpaceId WHERE [spaceId] IS NULL;
    UPDATE [dbo].[ShoppingListItem] SET [spaceId] = @PersonalSpaceId WHERE [spaceId] IS NULL;

    IF (SELECT COUNT_BIG(*) FROM [dbo].[Category] WHERE [spaceId] = @PersonalSpaceId) <> @CategoryCount
       OR (SELECT COUNT_BIG(*) FROM [dbo].[FinancialEntry] WHERE [spaceId] = @PersonalSpaceId) <> @EntryCount
       OR (SELECT COUNT_BIG(*) FROM [dbo].[RecurringRule] WHERE [spaceId] = @PersonalSpaceId) <> @RuleCount
       OR (SELECT COUNT_BIG(*) FROM [dbo].[Budget] WHERE [spaceId] = @PersonalSpaceId) <> @BudgetCount
       OR (SELECT COUNT_BIG(*) FROM [dbo].[Supermarket] WHERE [spaceId] = @PersonalSpaceId) <> @SupermarketCount
       OR (SELECT COUNT_BIG(*) FROM [dbo].[ShoppingProduct] WHERE [spaceId] = @PersonalSpaceId) <> @ProductCount
       OR (SELECT COUNT_BIG(*) FROM [dbo].[ShoppingVariant] WHERE [spaceId] = @PersonalSpaceId) <> @VariantCount
       OR (SELECT COUNT_BIG(*) FROM [dbo].[ShoppingReceipt] WHERE [spaceId] = @PersonalSpaceId) <> @ReceiptCount
       OR (SELECT COUNT_BIG(*) FROM [dbo].[ShoppingReceiptItem] WHERE [spaceId] = @PersonalSpaceId) <> @ReceiptItemCount
       OR (SELECT COUNT_BIG(*) FROM [dbo].[ShoppingListItem] WHERE [spaceId] = @PersonalSpaceId) <> @ListItemCount
        THROW 51006, 'Backfill row counts do not match the pre-migration counts.', 1;

    IF EXISTS (
        SELECT 1 FROM [dbo].[FinancialEntry] AS e INNER JOIN [dbo].[Category] AS c ON c.[id] = e.[categoryId]
        WHERE e.[spaceId] <> c.[spaceId]
    ) OR EXISTS (
        SELECT 1 FROM [dbo].[RecurringRule] AS r INNER JOIN [dbo].[Category] AS c ON c.[id] = r.[categoryId]
        WHERE r.[spaceId] <> c.[spaceId]
    ) OR EXISTS (
        SELECT 1 FROM [dbo].[Budget] AS b INNER JOIN [dbo].[Category] AS c ON c.[id] = b.[categoryId]
        WHERE b.[spaceId] <> c.[spaceId]
    ) OR EXISTS (
        SELECT 1 FROM [dbo].[ShoppingVariant] AS v INNER JOIN [dbo].[ShoppingProduct] AS p ON p.[id] = v.[productId]
        WHERE v.[spaceId] <> p.[spaceId]
    ) OR EXISTS (
        SELECT 1 FROM [dbo].[ShoppingReceipt] AS r
        INNER JOIN [dbo].[Supermarket] AS s ON s.[id] = r.[supermarketId]
        INNER JOIN [dbo].[FinancialEntry] AS e ON e.[id] = r.[financialEntryId]
        WHERE r.[spaceId] <> s.[spaceId] OR r.[spaceId] <> e.[spaceId]
    ) OR EXISTS (
        SELECT 1 FROM [dbo].[ShoppingReceiptItem] AS i
        INNER JOIN [dbo].[ShoppingReceipt] AS r ON r.[id] = i.[receiptId]
        INNER JOIN [dbo].[ShoppingProduct] AS p ON p.[id] = i.[productId]
        INNER JOIN [dbo].[ShoppingVariant] AS v ON v.[id] = i.[variantId]
        WHERE i.[spaceId] <> r.[spaceId] OR i.[spaceId] <> p.[spaceId] OR i.[spaceId] <> v.[spaceId]
    ) OR EXISTS (
        SELECT 1 FROM [dbo].[ShoppingListItem] AS l INNER JOIN [dbo].[ShoppingProduct] AS p ON p.[id] = l.[productId]
        WHERE l.[spaceId] <> p.[spaceId]
    )
        THROW 51007, 'A related record crosses space boundaries; tenant finalization is aborted.', 1;

    -- SQL Server no permite cambiar la nulabilidad mientras existan índices o FKs
    -- dependientes de estas columnas. Se retiran temporalmente y se restauran abajo.
    DROP INDEX [Category_spaceId_type_idx] ON [dbo].[Category];
    DROP INDEX [Category_spaceId_sourceCoLifeSpaceId_idx] ON [dbo].[Category];
    DROP INDEX [FinancialEntry_spaceId_date_type_status_idx] ON [dbo].[FinancialEntry];
    DROP INDEX [FinancialEntry_spaceId_categoryId_date_idx] ON [dbo].[FinancialEntry];
    DROP INDEX [RecurringRule_spaceId_active_startDate_idx] ON [dbo].[RecurringRule];
    DROP INDEX [Budget_spaceId_month_idx] ON [dbo].[Budget];
    DROP INDEX [Supermarket_spaceId_idx] ON [dbo].[Supermarket];
    DROP INDEX [ShoppingProduct_spaceId_active_name_idx] ON [dbo].[ShoppingProduct];
    DROP INDEX [ShoppingVariant_spaceId_productId_active_idx] ON [dbo].[ShoppingVariant];
    DROP INDEX [ShoppingReceipt_spaceId_supermarketId_date_idx] ON [dbo].[ShoppingReceipt];
    DROP INDEX [ShoppingReceipt_spaceId_date_idx] ON [dbo].[ShoppingReceipt];
    DROP INDEX [ShoppingReceiptItem_spaceId_productId_createdAt_idx] ON [dbo].[ShoppingReceiptItem];
    DROP INDEX [ShoppingReceiptItem_spaceId_variantId_createdAt_idx] ON [dbo].[ShoppingReceiptItem];
    DROP INDEX [ShoppingListItem_spaceId_createdAt_idx] ON [dbo].[ShoppingListItem];

    ALTER TABLE [dbo].[Category] DROP CONSTRAINT [Category_spaceId_fkey];
    ALTER TABLE [dbo].[FinancialEntry] DROP CONSTRAINT [FinancialEntry_spaceId_fkey];
    ALTER TABLE [dbo].[RecurringRule] DROP CONSTRAINT [RecurringRule_spaceId_fkey];
    ALTER TABLE [dbo].[Budget] DROP CONSTRAINT [Budget_spaceId_fkey];
    ALTER TABLE [dbo].[Supermarket] DROP CONSTRAINT [Supermarket_spaceId_fkey];
    ALTER TABLE [dbo].[ShoppingProduct] DROP CONSTRAINT [ShoppingProduct_spaceId_fkey];
    ALTER TABLE [dbo].[ShoppingVariant] DROP CONSTRAINT [ShoppingVariant_spaceId_fkey];
    ALTER TABLE [dbo].[ShoppingReceipt] DROP CONSTRAINT [ShoppingReceipt_spaceId_fkey];
    ALTER TABLE [dbo].[ShoppingReceiptItem] DROP CONSTRAINT [ShoppingReceiptItem_spaceId_fkey];
    ALTER TABLE [dbo].[ShoppingListItem] DROP CONSTRAINT [ShoppingListItem_spaceId_fkey];

    ALTER TABLE [dbo].[Category] ALTER COLUMN [spaceId] NVARCHAR(30) NOT NULL;
    ALTER TABLE [dbo].[FinancialEntry] ALTER COLUMN [spaceId] NVARCHAR(30) NOT NULL;
    ALTER TABLE [dbo].[RecurringRule] ALTER COLUMN [spaceId] NVARCHAR(30) NOT NULL;
    ALTER TABLE [dbo].[Budget] ALTER COLUMN [spaceId] NVARCHAR(30) NOT NULL;
    ALTER TABLE [dbo].[Supermarket] ALTER COLUMN [spaceId] NVARCHAR(30) NOT NULL;
    ALTER TABLE [dbo].[ShoppingProduct] ALTER COLUMN [spaceId] NVARCHAR(30) NOT NULL;
    ALTER TABLE [dbo].[ShoppingVariant] ALTER COLUMN [spaceId] NVARCHAR(30) NOT NULL;
    ALTER TABLE [dbo].[ShoppingReceipt] ALTER COLUMN [spaceId] NVARCHAR(30) NOT NULL;
    ALTER TABLE [dbo].[ShoppingReceiptItem] ALTER COLUMN [spaceId] NVARCHAR(30) NOT NULL;
    ALTER TABLE [dbo].[ShoppingListItem] ALTER COLUMN [spaceId] NVARCHAR(30) NOT NULL;

    ALTER TABLE [dbo].[Category] ADD CONSTRAINT [Category_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[FinancialEntry] ADD CONSTRAINT [FinancialEntry_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[RecurringRule] ADD CONSTRAINT [RecurringRule_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[Budget] ADD CONSTRAINT [Budget_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[Supermarket] ADD CONSTRAINT [Supermarket_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[ShoppingProduct] ADD CONSTRAINT [ShoppingProduct_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[ShoppingVariant] ADD CONSTRAINT [ShoppingVariant_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[ShoppingReceipt] ADD CONSTRAINT [ShoppingReceipt_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[ShoppingReceiptItem] ADD CONSTRAINT [ShoppingReceiptItem_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[ShoppingListItem] ADD CONSTRAINT [ShoppingListItem_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

    CREATE INDEX [Category_spaceId_type_idx] ON [dbo].[Category]([spaceId], [type]);
    CREATE INDEX [Category_spaceId_sourceCoLifeSpaceId_idx] ON [dbo].[Category]([spaceId], [sourceCoLifeSpaceId]);
    CREATE INDEX [FinancialEntry_spaceId_date_type_status_idx] ON [dbo].[FinancialEntry]([spaceId], [date], [type], [status]);
    CREATE INDEX [FinancialEntry_spaceId_categoryId_date_idx] ON [dbo].[FinancialEntry]([spaceId], [categoryId], [date]);
    CREATE INDEX [RecurringRule_spaceId_active_startDate_idx] ON [dbo].[RecurringRule]([spaceId], [active], [startDate]);
    CREATE INDEX [Budget_spaceId_month_idx] ON [dbo].[Budget]([spaceId], [month]);
    CREATE INDEX [Supermarket_spaceId_idx] ON [dbo].[Supermarket]([spaceId]);
    CREATE INDEX [ShoppingProduct_spaceId_active_name_idx] ON [dbo].[ShoppingProduct]([spaceId], [active], [name]);
    CREATE INDEX [ShoppingVariant_spaceId_productId_active_idx] ON [dbo].[ShoppingVariant]([spaceId], [productId], [active]);
    CREATE INDEX [ShoppingReceipt_spaceId_supermarketId_date_idx] ON [dbo].[ShoppingReceipt]([spaceId], [supermarketId], [date]);
    CREATE INDEX [ShoppingReceipt_spaceId_date_idx] ON [dbo].[ShoppingReceipt]([spaceId], [date]);
    CREATE INDEX [ShoppingReceiptItem_spaceId_productId_createdAt_idx] ON [dbo].[ShoppingReceiptItem]([spaceId], [productId], [createdAt]);
    CREATE INDEX [ShoppingReceiptItem_spaceId_variantId_createdAt_idx] ON [dbo].[ShoppingReceiptItem]([spaceId], [variantId], [createdAt]);
    CREATE INDEX [ShoppingListItem_spaceId_createdAt_idx] ON [dbo].[ShoppingListItem]([spaceId], [createdAt]);

    DROP INDEX [Category_name_type_key] ON [dbo].[Category];
    ALTER TABLE [dbo].[Supermarket] DROP CONSTRAINT [Supermarket_normalizedName_key];
    ALTER TABLE [dbo].[ShoppingProduct] DROP CONSTRAINT [ShoppingProduct_normalizedName_key];
    DROP INDEX [ShoppingVariant_productId_normalizedBrand_normalizedPackage_key] ON [dbo].[ShoppingVariant];

    CREATE UNIQUE INDEX [Category_spaceId_name_type_key] ON [dbo].[Category]([spaceId], [name], [type]);
    CREATE UNIQUE INDEX [Supermarket_spaceId_normalizedName_key] ON [dbo].[Supermarket]([spaceId], [normalizedName]);
    CREATE UNIQUE INDEX [ShoppingProduct_spaceId_normalizedName_key] ON [dbo].[ShoppingProduct]([spaceId], [normalizedName]);
    CREATE UNIQUE INDEX [ShoppingVariant_spaceId_productId_normalizedBrand_normalizedPackage_key]
        ON [dbo].[ShoppingVariant]([spaceId], [productId], [normalizedBrand], [normalizedPackage]);

    IF EXISTS (SELECT 1 FROM [dbo].[Category] WHERE [spaceId] IS NULL)
       OR EXISTS (SELECT 1 FROM [dbo].[FinancialEntry] WHERE [spaceId] IS NULL)
       OR EXISTS (SELECT 1 FROM [dbo].[RecurringRule] WHERE [spaceId] IS NULL)
       OR EXISTS (SELECT 1 FROM [dbo].[Budget] WHERE [spaceId] IS NULL)
       OR EXISTS (SELECT 1 FROM [dbo].[Supermarket] WHERE [spaceId] IS NULL)
       OR EXISTS (SELECT 1 FROM [dbo].[ShoppingProduct] WHERE [spaceId] IS NULL)
       OR EXISTS (SELECT 1 FROM [dbo].[ShoppingVariant] WHERE [spaceId] IS NULL)
       OR EXISTS (SELECT 1 FROM [dbo].[ShoppingReceipt] WHERE [spaceId] IS NULL)
       OR EXISTS (SELECT 1 FROM [dbo].[ShoppingReceiptItem] WHERE [spaceId] IS NULL)
       OR EXISTS (SELECT 1 FROM [dbo].[ShoppingListItem] WHERE [spaceId] IS NULL)
        THROW 51008, 'Tenant columns must not contain NULL after finalization.', 1;

    INSERT INTO [dbo].[TenantBackfillControl] ([id], [targetUserId], [completedAt])
    VALUES (N'legacy-personal-v1', @OwnerUserId, SYSUTCDATETIME());

    COMMIT TRANSACTION;
    PRINT N'Legacy backfill and tenant finalization completed. Keep TENANT_DATA_READY=false until post-run checks pass.';
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
