SET XACT_ABORT ON;
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
    CONSTRAINT [User_googleSubject_key] UNIQUE ([googleSubject])
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

CREATE TABLE [dbo].[UserSession] (
    [id] NVARCHAR(30) NOT NULL,
    [userId] NVARCHAR(30) NOT NULL,
    [tokenHash] NVARCHAR(64) NOT NULL,
    [csrfTokenHash] NVARCHAR(64) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [UserSession_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [expiresAt] DATETIME2 NOT NULL,
    [revokedAt] DATETIME2,
    CONSTRAINT [UserSession_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [UserSession_tokenHash_key] UNIQUE ([tokenHash])
);

CREATE TABLE [dbo].[OidcTransaction] (
    [id] NVARCHAR(30) NOT NULL,
    [stateHash] NVARCHAR(64) NOT NULL,
    [nonce] NVARCHAR(128) NOT NULL,
    [pkceVerifier] NVARCHAR(128) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [OidcTransaction_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [expiresAt] DATETIME2 NOT NULL,
    CONSTRAINT [OidcTransaction_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [OidcTransaction_stateHash_key] UNIQUE ([stateHash])
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
    CONSTRAINT [Invitation_spaceId_key] UNIQUE ([spaceId]),
    CONSTRAINT [Invitation_tokenHash_key] UNIQUE ([tokenHash])
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
    CONSTRAINT [TenantBackfillControl_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [TenantBackfillControl_targetUserId_fkey] FOREIGN KEY ([targetUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION
);

ALTER TABLE [dbo].[Category] ADD [spaceId] NVARCHAR(30) NULL, [sourceCoLifeSpaceId] NVARCHAR(30) NULL;
ALTER TABLE [dbo].[FinancialEntry] ADD [spaceId] NVARCHAR(30) NULL, [payerUserId] NVARCHAR(30) NULL, [derivedShareId] NVARCHAR(30) NULL, [voidedAt] DATETIME2 NULL;
ALTER TABLE [dbo].[RecurringRule] ADD [spaceId] NVARCHAR(30) NULL, [payerUserId] NVARCHAR(30) NULL, [splitMode] NVARCHAR(16) NULL, [deletedAt] DATETIME2 NULL;
ALTER TABLE [dbo].[Budget] ADD [spaceId] NVARCHAR(30) NULL;
ALTER TABLE [dbo].[Supermarket] ADD [spaceId] NVARCHAR(30) NULL;
ALTER TABLE [dbo].[ShoppingProduct] ADD [spaceId] NVARCHAR(30) NULL;
ALTER TABLE [dbo].[ShoppingVariant] ADD [spaceId] NVARCHAR(30) NULL;
ALTER TABLE [dbo].[ShoppingReceipt] ADD [spaceId] NVARCHAR(30) NULL, [voidedAt] DATETIME2 NULL;
ALTER TABLE [dbo].[ShoppingReceiptItem] ADD [spaceId] NVARCHAR(30) NULL;
ALTER TABLE [dbo].[ShoppingListItem] ADD [spaceId] NVARCHAR(30) NULL;

ALTER TABLE [dbo].[Space] ADD CONSTRAINT [Space_createdByUserId_fkey] FOREIGN KEY ([createdByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[UserSession] ADD CONSTRAINT [UserSession_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
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
ALTER TABLE [dbo].[RecurringShare] ADD CONSTRAINT [RecurringShare_ruleId_fkey] FOREIGN KEY ([ruleId]) REFERENCES [dbo].[RecurringRule]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[RecurringShare] ADD CONSTRAINT [RecurringShare_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[SettlementAdjustment] ADD CONSTRAINT [SettlementAdjustment_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Category] ADD CONSTRAINT [Category_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Category] ADD CONSTRAINT [Category_sourceCoLifeSpaceId_fkey] FOREIGN KEY ([sourceCoLifeSpaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[FinancialEntry] ADD CONSTRAINT [FinancialEntry_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[FinancialEntry] ADD CONSTRAINT [FinancialEntry_payerUserId_fkey] FOREIGN KEY ([payerUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[FinancialEntry] ADD CONSTRAINT [FinancialEntry_derivedShareId_fkey] FOREIGN KEY ([derivedShareId]) REFERENCES [dbo].[ExpenseShare]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[RecurringRule] ADD CONSTRAINT [RecurringRule_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[RecurringRule] ADD CONSTRAINT [RecurringRule_payerUserId_fkey] FOREIGN KEY ([payerUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Budget] ADD CONSTRAINT [Budget_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Supermarket] ADD CONSTRAINT [Supermarket_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[ShoppingProduct] ADD CONSTRAINT [ShoppingProduct_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[ShoppingVariant] ADD CONSTRAINT [ShoppingVariant_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[ShoppingReceipt] ADD CONSTRAINT [ShoppingReceipt_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[ShoppingReceiptItem] ADD CONSTRAINT [ShoppingReceiptItem_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[ShoppingListItem] ADD CONSTRAINT [ShoppingListItem_spaceId_fkey] FOREIGN KEY ([spaceId]) REFERENCES [dbo].[Space]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[SettlementAdjustment] ADD CONSTRAINT [SettlementAdjustment_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE INDEX [Space_type_archivedAt_idx] ON [dbo].[Space]([type], [archivedAt]);
CREATE INDEX [UserSession_userId_expiresAt_idx] ON [dbo].[UserSession]([userId], [expiresAt]);
CREATE INDEX [OidcTransaction_expiresAt_idx] ON [dbo].[OidcTransaction]([expiresAt]);
CREATE UNIQUE INDEX [Membership_spaceId_userId_key] ON [dbo].[Membership]([spaceId], [userId]);
CREATE INDEX [Membership_userId_status_idx] ON [dbo].[Membership]([userId], [status]);
CREATE INDEX [AuditEvent_spaceId_createdAt_idx] ON [dbo].[AuditEvent]([spaceId], [createdAt]);
CREATE INDEX [AuditEvent_entityType_entityId_idx] ON [dbo].[AuditEvent]([entityType], [entityId]);
CREATE INDEX [Settlement_spaceId_paidAt_idx] ON [dbo].[Settlement]([spaceId], [paidAt]);
CREATE INDEX [Settlement_fromUserId_toUserId_idx] ON [dbo].[Settlement]([fromUserId], [toUserId]);
CREATE UNIQUE INDEX [ExpenseShare_entryId_userId_key] ON [dbo].[ExpenseShare]([entryId], [userId]);
CREATE INDEX [ExpenseShare_userId_createdAt_idx] ON [dbo].[ExpenseShare]([userId], [createdAt]);
CREATE UNIQUE INDEX [RecurringShare_ruleId_userId_key] ON [dbo].[RecurringShare]([ruleId], [userId]);
CREATE INDEX [RecurringShare_userId_createdAt_idx] ON [dbo].[RecurringShare]([userId], [createdAt]);
CREATE INDEX [SettlementAdjustment_spaceId_userId_createdAt_idx] ON [dbo].[SettlementAdjustment]([spaceId], [userId], [createdAt]);
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
EXEC sys.sp_executesql N'CREATE UNIQUE INDEX [FinancialEntry_derivedShareId_key] ON [dbo].[FinancialEntry]([derivedShareId]) WHERE [derivedShareId] IS NOT NULL;';

COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
