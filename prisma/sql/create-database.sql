/*
  MyLife — schema creation for a brand-new SQL Server / Azure SQL database.

  Run this script while connected to an EMPTY database. It creates the application
  tables, indexes, constraints and foreign keys; it does not create the Azure SQL
  database resource itself, insert users/categories, or migrate existing data.
  For an existing installation, use prisma/migrations instead.

  Keep this file aligned with prisma/schema.prisma and the migration history.
  Several CHECK constraints and filtered indexes below are intentional SQL Server
  details that Prisma's schema format does not currently express.
*/
SET XACT_ABORT ON;

IF OBJECT_ID(N'[dbo].[User]', N'U') IS NOT NULL
    THROW 51020, 'This database is not empty (dbo.User already exists). Use an empty database.', 1;

BEGIN TRY
    BEGIN TRANSACTION;

    CREATE TABLE [dbo].[User] (
        [id] NVARCHAR(30) NOT NULL,
        [googleSubject] NVARCHAR(255) NOT NULL,
        [email] NVARCHAR(320) NOT NULL,
        [displayName] NVARCHAR(160),
        [avatarUrl] NVARCHAR(500),
        [createdAt] DATETIME2 NOT NULL CONSTRAINT [User_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
        [updatedAt] DATETIME2 NOT NULL,
        CONSTRAINT [User_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [User_googleSubject_key] UNIQUE NONCLUSTERED ([googleSubject])
    );

    CREATE TABLE [dbo].[UserSession] (
        [id] NVARCHAR(30) NOT NULL,
        [userId] NVARCHAR(30) NOT NULL,
        [tokenHash] NVARCHAR(64) NOT NULL,
        [csrfTokenHash] NVARCHAR(64) NOT NULL,
        [createdAt] DATETIME2 NOT NULL CONSTRAINT [UserSession_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
        [expiresAt] DATETIME2 NOT NULL,
        [revokedAt] DATETIME2,
        CONSTRAINT [UserSession_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [UserSession_tokenHash_key] UNIQUE NONCLUSTERED ([tokenHash])
    );

    CREATE TABLE [dbo].[OidcTransaction] (
        [id] NVARCHAR(30) NOT NULL,
        [stateHash] NVARCHAR(64) NOT NULL,
        [nonce] NVARCHAR(128) NOT NULL,
        [pkceVerifier] NVARCHAR(128) NOT NULL,
        [createdAt] DATETIME2 NOT NULL CONSTRAINT [OidcTransaction_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
        [expiresAt] DATETIME2 NOT NULL,
        CONSTRAINT [OidcTransaction_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [OidcTransaction_stateHash_key] UNIQUE NONCLUSTERED ([stateHash])
    );

    CREATE TABLE [dbo].[Space] (
        [id] NVARCHAR(30) NOT NULL,
        [name] NVARCHAR(100) NOT NULL,
        [type] NVARCHAR(16) NOT NULL,
        [currency] NVARCHAR(3) NOT NULL CONSTRAINT [Space_currency_df] DEFAULT N'EUR',
        [createdByUserId] NVARCHAR(30),
        [archivedAt] DATETIME2,
        [createdAt] DATETIME2 NOT NULL CONSTRAINT [Space_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
        [updatedAt] DATETIME2 NOT NULL,
        CONSTRAINT [Space_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [Space_type_check] CHECK ([type] IN (N'PERSONAL', N'COLIFE'))
    );

    CREATE TABLE [dbo].[Membership] (
        [id] NVARCHAR(30) NOT NULL,
        [spaceId] NVARCHAR(30) NOT NULL,
        [userId] NVARCHAR(30) NOT NULL,
        [role] NVARCHAR(16) NOT NULL,
        [status] NVARCHAR(16) NOT NULL CONSTRAINT [Membership_status_df] DEFAULT N'ACTIVE',
        [joinedAt] DATETIME2 NOT NULL CONSTRAINT [Membership_joinedAt_df] DEFAULT CURRENT_TIMESTAMP,
        [leftAt] DATETIME2,
        [createdAt] DATETIME2 NOT NULL CONSTRAINT [Membership_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
        [updatedAt] DATETIME2 NOT NULL,
        CONSTRAINT [Membership_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [Membership_spaceId_userId_key] UNIQUE NONCLUSTERED ([spaceId], [userId]),
        CONSTRAINT [Membership_role_check] CHECK ([role] IN (N'ADMIN', N'MEMBER')),
        CONSTRAINT [Membership_status_check] CHECK ([status] IN (N'ACTIVE', N'LEFT'))
    );

    CREATE TABLE [dbo].[Invitation] (
        [id] NVARCHAR(30) NOT NULL,
        [spaceId] NVARCHAR(30) NOT NULL,
        [tokenHash] NVARCHAR(64) NOT NULL,
        [acceptanceOpen] BIT NOT NULL CONSTRAINT [Invitation_acceptanceOpen_df] DEFAULT 0,
        [createdByUserId] NVARCHAR(30) NOT NULL,
        [createdAt] DATETIME2 NOT NULL CONSTRAINT [Invitation_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
        [updatedAt] DATETIME2 NOT NULL,
        CONSTRAINT [Invitation_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [Invitation_spaceId_key] UNIQUE NONCLUSTERED ([spaceId]),
        CONSTRAINT [Invitation_tokenHash_key] UNIQUE NONCLUSTERED ([tokenHash])
    );

    CREATE TABLE [dbo].[AuditEvent] (
        [id] NVARCHAR(30) NOT NULL,
        [spaceId] NVARCHAR(30) NOT NULL,
        [actorId] NVARCHAR(30) NOT NULL,
        [entityType] NVARCHAR(40) NOT NULL,
        [entityId] NVARCHAR(30) NOT NULL,
        [action] NVARCHAR(40) NOT NULL,
        [details] NVARCHAR(MAX) NOT NULL,
        [createdAt] DATETIME2 NOT NULL CONSTRAINT [AuditEvent_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT [AuditEvent_pkey] PRIMARY KEY CLUSTERED ([id])
    );

    CREATE TABLE [dbo].[Settlement] (
        [id] NVARCHAR(30) NOT NULL,
        [spaceId] NVARCHAR(30) NOT NULL,
        [fromUserId] NVARCHAR(30) NOT NULL,
        [toUserId] NVARCHAR(30) NOT NULL,
        [createdByUserId] NVARCHAR(30) NOT NULL,
        [amount] DECIMAL(12, 2) NOT NULL,
        [note] NVARCHAR(160),
        [paidAt] DATETIME2 NOT NULL,
        [createdAt] DATETIME2 NOT NULL CONSTRAINT [Settlement_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT [Settlement_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [Settlement_amount_check] CHECK ([amount] > 0),
        CONSTRAINT [Settlement_users_check] CHECK ([fromUserId] <> [toUserId])
    );

    CREATE TABLE [dbo].[ExpenseShare] (
        [id] NVARCHAR(30) NOT NULL,
        [entryId] NVARCHAR(30) NOT NULL,
        [userId] NVARCHAR(30) NOT NULL,
        [amount] DECIMAL(12, 2) NOT NULL,
        [allocationType] NVARCHAR(16) NOT NULL,
        [shareBasis] INT,
        [isActive] BIT NOT NULL CONSTRAINT [ExpenseShare_isActive_df] DEFAULT 1,
        [createdAt] DATETIME2 NOT NULL CONSTRAINT [ExpenseShare_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
        [updatedAt] DATETIME2 NOT NULL,
        CONSTRAINT [ExpenseShare_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [ExpenseShare_entryId_userId_key] UNIQUE NONCLUSTERED ([entryId], [userId]),
        CONSTRAINT [ExpenseShare_amount_check] CHECK ([amount] >= 0),
        CONSTRAINT [ExpenseShare_type_check] CHECK ([allocationType] IN (N'EQUAL', N'PERCENTAGE', N'EXACT'))
    );

    CREATE TABLE [dbo].[RecurringShare] (
        [id] NVARCHAR(30) NOT NULL,
        [ruleId] NVARCHAR(30) NOT NULL,
        [userId] NVARCHAR(30) NOT NULL,
        [allocationType] NVARCHAR(16) NOT NULL,
        [shareBasis] INT,
        [exactAmount] DECIMAL(12, 2),
        [createdAt] DATETIME2 NOT NULL CONSTRAINT [RecurringShare_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT [RecurringShare_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [RecurringShare_ruleId_userId_key] UNIQUE NONCLUSTERED ([ruleId], [userId]),
        CONSTRAINT [RecurringShare_type_check] CHECK ([allocationType] IN (N'EQUAL', N'PERCENTAGE', N'EXACT'))
    );

    CREATE TABLE [dbo].[SettlementAdjustment] (
        [id] NVARCHAR(30) NOT NULL,
        [spaceId] NVARCHAR(30) NOT NULL,
        [userId] NVARCHAR(30) NOT NULL,
        [amount] DECIMAL(12, 2) NOT NULL,
        [reason] NVARCHAR(160) NOT NULL,
        [createdAt] DATETIME2 NOT NULL CONSTRAINT [SettlementAdjustment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT [SettlementAdjustment_pkey] PRIMARY KEY CLUSTERED ([id])
    );

    CREATE TABLE [dbo].[TenantBackfillControl] (
        [id] NVARCHAR(40) NOT NULL,
        [targetUserId] NVARCHAR(30) NOT NULL,
        [completedAt] DATETIME2 NOT NULL,
        CONSTRAINT [TenantBackfillControl_pkey] PRIMARY KEY CLUSTERED ([id])
    );

    CREATE TABLE [dbo].[Category] (
        [id] NVARCHAR(30) NOT NULL,
        [spaceId] NVARCHAR(30) NOT NULL,
        [name] NVARCHAR(40) NOT NULL,
        [type] NVARCHAR(16) NOT NULL,
        [color] NVARCHAR(7) NOT NULL CONSTRAINT [Category_color_df] DEFAULT N'#7c8da6',
        [icon] NVARCHAR(30) NOT NULL CONSTRAINT [Category_icon_df] DEFAULT N'circle',
        [createdAt] DATETIME2 NOT NULL CONSTRAINT [Category_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
        [updatedAt] DATETIME2 NOT NULL,
        [sourceCoLifeSpaceId] NVARCHAR(30),
        CONSTRAINT [Category_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [Category_spaceId_name_type_key] UNIQUE NONCLUSTERED ([spaceId], [name], [type]),
        CONSTRAINT [Category_type_check] CHECK ([type] IN (N'INCOME', N'EXPENSE'))
    );

    CREATE TABLE [dbo].[FinancialEntry] (
        [id] NVARCHAR(30) NOT NULL,
        [spaceId] NVARCHAR(30) NOT NULL,
        [type] NVARCHAR(16) NOT NULL,
        [status] NVARCHAR(16) NOT NULL CONSTRAINT [FinancialEntry_status_df] DEFAULT N'CONFIRMED',
        [amount] DECIMAL(12, 2) NOT NULL,
        [description] NVARCHAR(160) NOT NULL,
        [date] DATE NOT NULL,
        [isFixed] BIT NOT NULL CONSTRAINT [FinancialEntry_isFixed_df] DEFAULT 0,
        [categoryId] NVARCHAR(30) NOT NULL,
        [recurringRuleId] NVARCHAR(30),
        [scheduledFor] DATE,
        [payerUserId] NVARCHAR(30),
        [derivedShareId] NVARCHAR(30),
        [voidedAt] DATETIME2,
        [createdAt] DATETIME2 NOT NULL CONSTRAINT [FinancialEntry_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
        [updatedAt] DATETIME2 NOT NULL,
        CONSTRAINT [FinancialEntry_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [FinancialEntry_type_check] CHECK ([type] IN (N'INCOME', N'EXPENSE')),
        CONSTRAINT [FinancialEntry_status_check] CHECK ([status] IN (N'PENDING', N'CONFIRMED'))
    );

    CREATE TABLE [dbo].[RecurringRule] (
        [id] NVARCHAR(30) NOT NULL,
        [spaceId] NVARCHAR(30) NOT NULL,
        [payerUserId] NVARCHAR(30),
        [splitMode] NVARCHAR(16),
        [type] NVARCHAR(16) NOT NULL,
        [amount] DECIMAL(12, 2) NOT NULL,
        [description] NVARCHAR(160) NOT NULL,
        [categoryId] NVARCHAR(30) NOT NULL,
        [startDate] DATE NOT NULL,
        [endDate] DATE,
        [scheduleDay] INT NOT NULL,
        [active] BIT NOT NULL CONSTRAINT [RecurringRule_active_df] DEFAULT 1,
        [deletedAt] DATETIME2,
        [createdAt] DATETIME2 NOT NULL CONSTRAINT [RecurringRule_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
        [updatedAt] DATETIME2 NOT NULL,
        CONSTRAINT [RecurringRule_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [RecurringRule_type_check] CHECK ([type] IN (N'INCOME', N'EXPENSE'))
    );

    CREATE TABLE [dbo].[Budget] (
        [id] NVARCHAR(30) NOT NULL,
        [spaceId] NVARCHAR(30) NOT NULL,
        [categoryId] NVARCHAR(30) NOT NULL,
        [month] DATE NOT NULL,
        [limitAmount] DECIMAL(12, 2) NOT NULL,
        [createdAt] DATETIME2 NOT NULL CONSTRAINT [Budget_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
        [updatedAt] DATETIME2 NOT NULL,
        CONSTRAINT [Budget_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [Budget_categoryId_month_key] UNIQUE NONCLUSTERED ([categoryId], [month])
    );

    CREATE TABLE [dbo].[Supermarket] (
        [id] NVARCHAR(30) NOT NULL,
        [spaceId] NVARCHAR(30) NOT NULL,
        [name] NVARCHAR(80) NOT NULL,
        [normalizedName] NVARCHAR(80) NOT NULL,
        [active] BIT NOT NULL CONSTRAINT [Supermarket_active_df] DEFAULT 1,
        [createdAt] DATETIME2 NOT NULL CONSTRAINT [Supermarket_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
        [updatedAt] DATETIME2 NOT NULL,
        CONSTRAINT [Supermarket_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [Supermarket_spaceId_normalizedName_key] UNIQUE NONCLUSTERED ([spaceId], [normalizedName])
    );

    CREATE TABLE [dbo].[ShoppingProduct] (
        [id] NVARCHAR(30) NOT NULL,
        [spaceId] NVARCHAR(30) NOT NULL,
        [name] NVARCHAR(100) NOT NULL,
        [normalizedName] NVARCHAR(100) NOT NULL,
        [dimension] NVARCHAR(12),
        [active] BIT NOT NULL CONSTRAINT [ShoppingProduct_active_df] DEFAULT 1,
        [createdAt] DATETIME2 NOT NULL CONSTRAINT [ShoppingProduct_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
        [updatedAt] DATETIME2 NOT NULL,
        CONSTRAINT [ShoppingProduct_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [ShoppingProduct_spaceId_normalizedName_key] UNIQUE NONCLUSTERED ([spaceId], [normalizedName]),
        CONSTRAINT [ShoppingProduct_dimension_check] CHECK ([dimension] IS NULL OR [dimension] IN (N'WEIGHT', N'VOLUME', N'COUNT'))
    );

    CREATE TABLE [dbo].[ShoppingVariant] (
        [id] NVARCHAR(30) NOT NULL,
        [spaceId] NVARCHAR(30) NOT NULL,
        [productId] NVARCHAR(30) NOT NULL,
        [brand] NVARCHAR(80),
        [normalizedBrand] NVARCHAR(80) NOT NULL CONSTRAINT [ShoppingVariant_normalizedBrand_df] DEFAULT N'',
        [packageLabel] NVARCHAR(100),
        [normalizedPackage] NVARCHAR(100) NOT NULL CONSTRAINT [ShoppingVariant_normalizedPackage_df] DEFAULT N'',
        [active] BIT NOT NULL CONSTRAINT [ShoppingVariant_active_df] DEFAULT 1,
        [createdAt] DATETIME2 NOT NULL CONSTRAINT [ShoppingVariant_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
        [updatedAt] DATETIME2 NOT NULL,
        CONSTRAINT [ShoppingVariant_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [ShoppingVariant_spaceId_productId_normalizedBrand_normalizedPackage_key] UNIQUE NONCLUSTERED ([spaceId], [productId], [normalizedBrand], [normalizedPackage])
    );

    CREATE TABLE [dbo].[ShoppingReceipt] (
        [id] NVARCHAR(30) NOT NULL,
        [spaceId] NVARCHAR(30) NOT NULL,
        [supermarketId] NVARCHAR(30) NOT NULL,
        [financialEntryId] NVARCHAR(30) NOT NULL,
        [date] DATE NOT NULL,
        [adjustment] DECIMAL(12, 2) NOT NULL CONSTRAINT [ShoppingReceipt_adjustment_df] DEFAULT 0,
        [totalAmount] DECIMAL(12, 2) NOT NULL,
        [voidedAt] DATETIME2,
        [createdAt] DATETIME2 NOT NULL CONSTRAINT [ShoppingReceipt_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
        [updatedAt] DATETIME2 NOT NULL,
        CONSTRAINT [ShoppingReceipt_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [ShoppingReceipt_financialEntryId_key] UNIQUE NONCLUSTERED ([financialEntryId]),
        CONSTRAINT [ShoppingReceipt_totalAmount_check] CHECK ([totalAmount] > 0)
    );

    CREATE TABLE [dbo].[ShoppingReceiptItem] (
        [id] NVARCHAR(30) NOT NULL,
        [spaceId] NVARCHAR(30) NOT NULL,
        [receiptId] NVARCHAR(30) NOT NULL,
        [productId] NVARCHAR(30) NOT NULL,
        [variantId] NVARCHAR(30) NOT NULL,
        [unit] NVARCHAR(4) NOT NULL,
        [unitsPurchased] INT NOT NULL CONSTRAINT [ShoppingReceiptItem_unitsPurchased_df] DEFAULT 1,
        [quantityBase] DECIMAL(12, 3) NOT NULL,
        [amount] DECIMAL(12, 2) NOT NULL,
        [createdAt] DATETIME2 NOT NULL CONSTRAINT [ShoppingReceiptItem_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT [ShoppingReceiptItem_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [ShoppingReceiptItem_unit_check] CHECK ([unit] IN (N'g', N'kg', N'ml', N'l', N'unit')),
        CONSTRAINT [ShoppingReceiptItem_unitsPurchased_check] CHECK ([unitsPurchased] > 0),
        CONSTRAINT [ShoppingReceiptItem_quantityBase_check] CHECK ([quantityBase] > 0),
        CONSTRAINT [ShoppingReceiptItem_amount_check] CHECK ([amount] > 0)
    );

    CREATE TABLE [dbo].[ShoppingListItem] (
        [id] NVARCHAR(30) NOT NULL,
        [spaceId] NVARCHAR(30) NOT NULL,
        [productId] NVARCHAR(30) NOT NULL,
        [note] NVARCHAR(160),
        [createdAt] DATETIME2 NOT NULL CONSTRAINT [ShoppingListItem_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
        [updatedAt] DATETIME2 NOT NULL,
        CONSTRAINT [ShoppingListItem_pkey] PRIMARY KEY CLUSTERED ([id]),
        CONSTRAINT [ShoppingListItem_productId_key] UNIQUE NONCLUSTERED ([productId])
    );

    -- Keep both unique indexes filtered: nullable values may occur on many rows.
    CREATE UNIQUE NONCLUSTERED INDEX [FinancialEntry_derivedShareId_key]
        ON [dbo].[FinancialEntry]([derivedShareId]) WHERE [derivedShareId] IS NOT NULL;
    CREATE UNIQUE NONCLUSTERED INDEX [FinancialEntry_recurringRuleId_scheduledFor_key]
        ON [dbo].[FinancialEntry]([recurringRuleId], [scheduledFor])
        WHERE [recurringRuleId] IS NOT NULL AND [scheduledFor] IS NOT NULL;

    CREATE NONCLUSTERED INDEX [UserSession_userId_expiresAt_idx] ON [dbo].[UserSession]([userId], [expiresAt]);
    CREATE NONCLUSTERED INDEX [OidcTransaction_expiresAt_idx] ON [dbo].[OidcTransaction]([expiresAt]);
    CREATE NONCLUSTERED INDEX [Space_type_archivedAt_idx] ON [dbo].[Space]([type], [archivedAt]);
    CREATE NONCLUSTERED INDEX [Membership_userId_status_idx] ON [dbo].[Membership]([userId], [status]);
    CREATE NONCLUSTERED INDEX [AuditEvent_spaceId_createdAt_idx] ON [dbo].[AuditEvent]([spaceId], [createdAt]);
    CREATE NONCLUSTERED INDEX [AuditEvent_entityType_entityId_idx] ON [dbo].[AuditEvent]([entityType], [entityId]);
    CREATE NONCLUSTERED INDEX [Settlement_spaceId_paidAt_idx] ON [dbo].[Settlement]([spaceId], [paidAt]);
    CREATE NONCLUSTERED INDEX [Settlement_fromUserId_toUserId_idx] ON [dbo].[Settlement]([fromUserId], [toUserId]);
    CREATE NONCLUSTERED INDEX [ExpenseShare_userId_createdAt_idx] ON [dbo].[ExpenseShare]([userId], [createdAt]);
    CREATE NONCLUSTERED INDEX [SettlementAdjustment_spaceId_userId_createdAt_idx] ON [dbo].[SettlementAdjustment]([spaceId], [userId], [createdAt]);
    CREATE NONCLUSTERED INDEX [Category_type_idx] ON [dbo].[Category]([type]);
    CREATE NONCLUSTERED INDEX [Category_spaceId_type_idx] ON [dbo].[Category]([spaceId], [type]);
    CREATE NONCLUSTERED INDEX [Category_spaceId_sourceCoLifeSpaceId_idx] ON [dbo].[Category]([spaceId], [sourceCoLifeSpaceId]);
    CREATE NONCLUSTERED INDEX [FinancialEntry_date_type_status_idx] ON [dbo].[FinancialEntry]([date], [type], [status]);
    CREATE NONCLUSTERED INDEX [FinancialEntry_spaceId_date_type_status_idx] ON [dbo].[FinancialEntry]([spaceId], [date], [type], [status]);
    CREATE NONCLUSTERED INDEX [FinancialEntry_spaceId_categoryId_date_idx] ON [dbo].[FinancialEntry]([spaceId], [categoryId], [date]);
    CREATE NONCLUSTERED INDEX [RecurringRule_spaceId_active_startDate_idx] ON [dbo].[RecurringRule]([spaceId], [active], [startDate]);
    CREATE NONCLUSTERED INDEX [RecurringRule_active_startDate_idx] ON [dbo].[RecurringRule]([active], [startDate]);
    CREATE NONCLUSTERED INDEX [RecurringShare_userId_createdAt_idx] ON [dbo].[RecurringShare]([userId], [createdAt]);
    CREATE NONCLUSTERED INDEX [Budget_spaceId_month_idx] ON [dbo].[Budget]([spaceId], [month]);
    CREATE NONCLUSTERED INDEX [Budget_month_idx] ON [dbo].[Budget]([month]);
    CREATE NONCLUSTERED INDEX [ShoppingProduct_spaceId_active_name_idx] ON [dbo].[ShoppingProduct]([spaceId], [active], [name]);
    CREATE NONCLUSTERED INDEX [ShoppingProduct_active_name_idx] ON [dbo].[ShoppingProduct]([active], [name]);
    CREATE NONCLUSTERED INDEX [ShoppingVariant_spaceId_productId_active_idx] ON [dbo].[ShoppingVariant]([spaceId], [productId], [active]);
    CREATE NONCLUSTERED INDEX [ShoppingVariant_productId_active_idx] ON [dbo].[ShoppingVariant]([productId], [active]);
    CREATE NONCLUSTERED INDEX [ShoppingReceipt_spaceId_supermarketId_date_idx] ON [dbo].[ShoppingReceipt]([spaceId], [supermarketId], [date]);
    CREATE NONCLUSTERED INDEX [ShoppingReceipt_spaceId_date_idx] ON [dbo].[ShoppingReceipt]([spaceId], [date]);
    CREATE NONCLUSTERED INDEX [ShoppingReceipt_supermarketId_date_idx] ON [dbo].[ShoppingReceipt]([supermarketId], [date]);
    CREATE NONCLUSTERED INDEX [ShoppingReceipt_date_idx] ON [dbo].[ShoppingReceipt]([date]);
    CREATE NONCLUSTERED INDEX [ShoppingReceiptItem_productId_createdAt_idx] ON [dbo].[ShoppingReceiptItem]([productId], [createdAt]);
    CREATE NONCLUSTERED INDEX [ShoppingReceiptItem_variantId_createdAt_idx] ON [dbo].[ShoppingReceiptItem]([variantId], [createdAt]);
    CREATE NONCLUSTERED INDEX [ShoppingReceiptItem_receiptId_idx] ON [dbo].[ShoppingReceiptItem]([receiptId]);
    CREATE NONCLUSTERED INDEX [ShoppingListItem_createdAt_idx] ON [dbo].[ShoppingListItem]([createdAt]);

    ALTER TABLE [dbo].[UserSession] ADD CONSTRAINT [UserSession_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[Space] ADD CONSTRAINT [Space_createdByUserId_fkey] FOREIGN KEY ([createdByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[Membership] ADD CONSTRAINT [Membership_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[Membership] ADD CONSTRAINT [Membership_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[Invitation] ADD CONSTRAINT [Invitation_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[Invitation] ADD CONSTRAINT [Invitation_createdByUserId_fkey] FOREIGN KEY ([createdByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[AuditEvent] ADD CONSTRAINT [AuditEvent_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[AuditEvent] ADD CONSTRAINT [AuditEvent_actorId_fkey] FOREIGN KEY ([actorId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[Settlement] ADD CONSTRAINT [Settlement_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[Settlement] ADD CONSTRAINT [Settlement_fromUserId_fkey] FOREIGN KEY ([fromUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[Settlement] ADD CONSTRAINT [Settlement_toUserId_fkey] FOREIGN KEY ([toUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[Settlement] ADD CONSTRAINT [Settlement_createdByUserId_fkey] FOREIGN KEY ([createdByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[ExpenseShare] ADD CONSTRAINT [ExpenseShare_entryId_fkey] FOREIGN KEY ([entryId]) REFERENCES [dbo].[FinancialEntry]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[ExpenseShare] ADD CONSTRAINT [ExpenseShare_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[SettlementAdjustment] ADD CONSTRAINT [SettlementAdjustment_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[SettlementAdjustment] ADD CONSTRAINT [SettlementAdjustment_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[TenantBackfillControl] ADD CONSTRAINT [TenantBackfillControl_targetUserId_fkey] FOREIGN KEY ([targetUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[Category] ADD CONSTRAINT [Category_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[Category] ADD CONSTRAINT [Category_sourceCoLifeSpaceId_fkey] FOREIGN KEY ([sourceCoLifeSpaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[FinancialEntry] ADD CONSTRAINT [FinancialEntry_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[FinancialEntry] ADD CONSTRAINT [FinancialEntry_categoryId_fkey] FOREIGN KEY ([categoryId]) REFERENCES [dbo].[Category]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[FinancialEntry] ADD CONSTRAINT [FinancialEntry_recurringRuleId_fkey] FOREIGN KEY ([recurringRuleId]) REFERENCES [dbo].[RecurringRule]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[FinancialEntry] ADD CONSTRAINT [FinancialEntry_payerUserId_fkey] FOREIGN KEY ([payerUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[FinancialEntry] ADD CONSTRAINT [FinancialEntry_derivedShareId_fkey] FOREIGN KEY ([derivedShareId]) REFERENCES [dbo].[ExpenseShare]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[RecurringRule] ADD CONSTRAINT [RecurringRule_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[RecurringRule] ADD CONSTRAINT [RecurringRule_payerUserId_fkey] FOREIGN KEY ([payerUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[RecurringRule] ADD CONSTRAINT [RecurringRule_categoryId_fkey] FOREIGN KEY ([categoryId]) REFERENCES [dbo].[Category]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[RecurringShare] ADD CONSTRAINT [RecurringShare_ruleId_fkey] FOREIGN KEY ([ruleId]) REFERENCES [dbo].[RecurringRule]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[RecurringShare] ADD CONSTRAINT [RecurringShare_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[Budget] ADD CONSTRAINT [Budget_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[Budget] ADD CONSTRAINT [Budget_categoryId_fkey] FOREIGN KEY ([categoryId]) REFERENCES [dbo].[Category]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[Supermarket] ADD CONSTRAINT [Supermarket_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[ShoppingProduct] ADD CONSTRAINT [ShoppingProduct_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[ShoppingVariant] ADD CONSTRAINT [ShoppingVariant_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[ShoppingVariant] ADD CONSTRAINT [ShoppingVariant_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[ShoppingProduct]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[ShoppingReceipt] ADD CONSTRAINT [ShoppingReceipt_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[ShoppingReceipt] ADD CONSTRAINT [ShoppingReceipt_supermarketId_fkey] FOREIGN KEY ([supermarketId]) REFERENCES [dbo].[Supermarket]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[ShoppingReceipt] ADD CONSTRAINT [ShoppingReceipt_financialEntryId_fkey] FOREIGN KEY ([financialEntryId]) REFERENCES [dbo].[FinancialEntry]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[ShoppingReceiptItem] ADD CONSTRAINT [ShoppingReceiptItem_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[ShoppingReceiptItem] ADD CONSTRAINT [ShoppingReceiptItem_receiptId_fkey] FOREIGN KEY ([receiptId]) REFERENCES [dbo].[ShoppingReceipt]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[ShoppingReceiptItem] ADD CONSTRAINT [ShoppingReceiptItem_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[ShoppingProduct]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[ShoppingReceiptItem] ADD CONSTRAINT [ShoppingReceiptItem_variantId_fkey] FOREIGN KEY ([variantId]) REFERENCES [dbo].[ShoppingVariant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[ShoppingListItem] ADD CONSTRAINT [ShoppingListItem_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[ShoppingListItem] ADD CONSTRAINT [ShoppingListItem_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[ShoppingProduct]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

    COMMIT TRANSACTION;
    PRINT N'MyLife schema creation completed.';
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
