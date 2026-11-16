SET XACT_ABORT ON;
BEGIN TRY
BEGIN TRANSACTION;

IF OBJECT_ID(N'[dbo].[ShoppingReceiptItem]', N'U') IS NULL
BEGIN
    ;THROW 50001, 'No existe dbo.ShoppingReceiptItem. Aplica primero la migración inicial de Compras.', 1;
END;

IF COL_LENGTH(N'dbo.ShoppingReceiptItem', N'unitsPurchased') IS NULL
BEGIN
    EXEC sys.sp_executesql N'
        ALTER TABLE [dbo].[ShoppingReceiptItem]
            ADD [unitsPurchased] INT NOT NULL
                CONSTRAINT [ShoppingReceiptItem_unitsPurchased_df] DEFAULT (1);';
END;

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE [name] = N'ShoppingReceiptItem_unitsPurchased_check'
      AND [parent_object_id] = OBJECT_ID(N'dbo.ShoppingReceiptItem')
)
BEGIN
    EXEC sys.sp_executesql N'
        ALTER TABLE [dbo].[ShoppingReceiptItem]
            ADD CONSTRAINT [ShoppingReceiptItem_unitsPurchased_check]
                CHECK ([unitsPurchased] > 0);';
END;

COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
