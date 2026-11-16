SET XACT_ABORT ON;
BEGIN TRY
BEGIN TRANSACTION;

CREATE TABLE [dbo].[Supermarket] (
    [id] NVARCHAR(30) NOT NULL,
    [name] NVARCHAR(80) NOT NULL,
    [normalizedName] NVARCHAR(80) NOT NULL,
    [active] BIT NOT NULL CONSTRAINT [Supermarket_active_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Supermarket_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Supermarket_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Supermarket_normalizedName_key] UNIQUE ([normalizedName])
);

CREATE TABLE [dbo].[ShoppingProduct] (
    [id] NVARCHAR(30) NOT NULL,
    [name] NVARCHAR(100) NOT NULL,
    [normalizedName] NVARCHAR(100) NOT NULL,
    [dimension] NVARCHAR(12),
    [active] BIT NOT NULL CONSTRAINT [ShoppingProduct_active_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ShoppingProduct_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ShoppingProduct_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ShoppingProduct_normalizedName_key] UNIQUE ([normalizedName]),
    CONSTRAINT [ShoppingProduct_dimension_check] CHECK ([dimension] IS NULL OR [dimension] IN (N'WEIGHT', N'VOLUME', N'COUNT'))
);

CREATE TABLE [dbo].[ShoppingVariant] (
    [id] NVARCHAR(30) NOT NULL,
    [productId] NVARCHAR(30) NOT NULL,
    [brand] NVARCHAR(80),
    [normalizedBrand] NVARCHAR(80) NOT NULL CONSTRAINT [ShoppingVariant_normalizedBrand_df] DEFAULT N'',
    [packageLabel] NVARCHAR(100),
    [normalizedPackage] NVARCHAR(100) NOT NULL CONSTRAINT [ShoppingVariant_normalizedPackage_df] DEFAULT N'',
    [active] BIT NOT NULL CONSTRAINT [ShoppingVariant_active_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ShoppingVariant_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ShoppingVariant_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ShoppingVariant_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[ShoppingProduct]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE TABLE [dbo].[ShoppingReceipt] (
    [id] NVARCHAR(30) NOT NULL,
    [supermarketId] NVARCHAR(30) NOT NULL,
    [financialEntryId] NVARCHAR(30) NOT NULL,
    [date] DATE NOT NULL,
    [adjustment] DECIMAL(12, 2) NOT NULL CONSTRAINT [ShoppingReceipt_adjustment_df] DEFAULT 0,
    [totalAmount] DECIMAL(12, 2) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ShoppingReceipt_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ShoppingReceipt_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ShoppingReceipt_totalAmount_check] CHECK ([totalAmount] > 0),
    CONSTRAINT [ShoppingReceipt_supermarketId_fkey] FOREIGN KEY ([supermarketId]) REFERENCES [dbo].[Supermarket]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT [ShoppingReceipt_financialEntryId_fkey] FOREIGN KEY ([financialEntryId]) REFERENCES [dbo].[FinancialEntry]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE TABLE [dbo].[ShoppingReceiptItem] (
    [id] NVARCHAR(30) NOT NULL,
    [receiptId] NVARCHAR(30) NOT NULL,
    [productId] NVARCHAR(30) NOT NULL,
    [variantId] NVARCHAR(30) NOT NULL,
    [unit] NVARCHAR(4) NOT NULL,
    [quantityBase] DECIMAL(12, 3) NOT NULL,
    [amount] DECIMAL(12, 2) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ShoppingReceiptItem_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ShoppingReceiptItem_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ShoppingReceiptItem_unit_check] CHECK ([unit] IN (N'g', N'kg', N'ml', N'l', N'unit')),
    CONSTRAINT [ShoppingReceiptItem_quantityBase_check] CHECK ([quantityBase] > 0),
    CONSTRAINT [ShoppingReceiptItem_amount_check] CHECK ([amount] > 0),
    CONSTRAINT [ShoppingReceiptItem_receiptId_fkey] FOREIGN KEY ([receiptId]) REFERENCES [dbo].[ShoppingReceipt]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT [ShoppingReceiptItem_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[ShoppingProduct]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT [ShoppingReceiptItem_variantId_fkey] FOREIGN KEY ([variantId]) REFERENCES [dbo].[ShoppingVariant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE TABLE [dbo].[ShoppingListItem] (
    [id] NVARCHAR(30) NOT NULL,
    [productId] NVARCHAR(30) NOT NULL,
    [note] NVARCHAR(160),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ShoppingListItem_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ShoppingListItem_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ShoppingListItem_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[ShoppingProduct]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX [ShoppingVariant_productId_normalizedBrand_normalizedPackage_key]
    ON [dbo].[ShoppingVariant]([productId], [normalizedBrand], [normalizedPackage]);
CREATE UNIQUE INDEX [ShoppingReceipt_financialEntryId_key] ON [dbo].[ShoppingReceipt]([financialEntryId]);
CREATE INDEX [ShoppingReceipt_supermarketId_date_idx] ON [dbo].[ShoppingReceipt]([supermarketId], [date]);
CREATE INDEX [ShoppingReceipt_date_idx] ON [dbo].[ShoppingReceipt]([date]);
CREATE INDEX [ShoppingReceiptItem_productId_createdAt_idx] ON [dbo].[ShoppingReceiptItem]([productId], [createdAt]);
CREATE INDEX [ShoppingReceiptItem_variantId_createdAt_idx] ON [dbo].[ShoppingReceiptItem]([variantId], [createdAt]);
CREATE INDEX [ShoppingReceiptItem_receiptId_idx] ON [dbo].[ShoppingReceiptItem]([receiptId]);
CREATE UNIQUE INDEX [ShoppingListItem_productId_key] ON [dbo].[ShoppingListItem]([productId]);
CREATE INDEX [ShoppingListItem_createdAt_idx] ON [dbo].[ShoppingListItem]([createdAt]);
CREATE INDEX [ShoppingProduct_active_name_idx] ON [dbo].[ShoppingProduct]([active], [name]);
CREATE INDEX [ShoppingVariant_productId_active_idx] ON [dbo].[ShoppingVariant]([productId], [active]);

COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
