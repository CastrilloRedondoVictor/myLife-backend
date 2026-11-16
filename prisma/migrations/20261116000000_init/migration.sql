SET XACT_ABORT ON;
BEGIN TRY
BEGIN TRANSACTION;

CREATE TABLE [dbo].[Category] (
    [id] NVARCHAR(30) NOT NULL,
    [name] NVARCHAR(40) NOT NULL,
    [type] NVARCHAR(16) NOT NULL,
    [color] NVARCHAR(7) NOT NULL CONSTRAINT [Category_color_df] DEFAULT N'#7c8da6',
    [icon] NVARCHAR(30) NOT NULL CONSTRAINT [Category_icon_df] DEFAULT N'circle',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Category_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2(3) NOT NULL,
    CONSTRAINT [Category_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Category_type_check] CHECK ([type] IN (N'INCOME', N'EXPENSE'))
);

CREATE TABLE [dbo].[RecurringRule] (
    [id] NVARCHAR(30) NOT NULL,
    [type] NVARCHAR(16) NOT NULL,
    [amount] DECIMAL(12, 2) NOT NULL,
    [description] NVARCHAR(160) NOT NULL,
    [categoryId] NVARCHAR(30) NOT NULL,
    [startDate] DATE NOT NULL,
    [endDate] DATE,
    [scheduleDay] INT NOT NULL,
    [active] BIT NOT NULL CONSTRAINT [RecurringRule_active_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [RecurringRule_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2(3) NOT NULL,
    CONSTRAINT [RecurringRule_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [RecurringRule_type_check] CHECK ([type] IN (N'INCOME', N'EXPENSE'))
);

CREATE TABLE [dbo].[FinancialEntry] (
    [id] NVARCHAR(30) NOT NULL,
    [type] NVARCHAR(16) NOT NULL,
    [status] NVARCHAR(16) NOT NULL CONSTRAINT [FinancialEntry_status_df] DEFAULT N'CONFIRMED',
    [amount] DECIMAL(12, 2) NOT NULL,
    [description] NVARCHAR(160) NOT NULL,
    [date] DATE NOT NULL,
    [isFixed] BIT NOT NULL CONSTRAINT [FinancialEntry_isFixed_df] DEFAULT 0,
    [categoryId] NVARCHAR(30) NOT NULL,
    [recurringRuleId] NVARCHAR(30),
    [scheduledFor] DATE,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [FinancialEntry_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2(3) NOT NULL,
    CONSTRAINT [FinancialEntry_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [FinancialEntry_type_check] CHECK ([type] IN (N'INCOME', N'EXPENSE')),
    CONSTRAINT [FinancialEntry_status_check] CHECK ([status] IN (N'PENDING', N'CONFIRMED'))
);

CREATE TABLE [dbo].[Budget] (
    [id] NVARCHAR(30) NOT NULL,
    [categoryId] NVARCHAR(30) NOT NULL,
    [month] DATE NOT NULL,
    [limitAmount] DECIMAL(12, 2) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Budget_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2(3) NOT NULL,
    CONSTRAINT [Budget_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE UNIQUE INDEX [Category_name_type_key] ON [dbo].[Category]([name], [type]);
CREATE INDEX [Category_type_idx] ON [dbo].[Category]([type]);
CREATE UNIQUE INDEX [FinancialEntry_recurringRuleId_scheduledFor_key]
    ON [dbo].[FinancialEntry]([recurringRuleId], [scheduledFor])
    WHERE [recurringRuleId] IS NOT NULL AND [scheduledFor] IS NOT NULL;
CREATE INDEX [FinancialEntry_date_type_status_idx] ON [dbo].[FinancialEntry]([date], [type], [status]);
CREATE INDEX [FinancialEntry_categoryId_date_idx] ON [dbo].[FinancialEntry]([categoryId], [date]);
CREATE INDEX [RecurringRule_active_startDate_idx] ON [dbo].[RecurringRule]([active], [startDate]);
CREATE UNIQUE INDEX [Budget_categoryId_month_key] ON [dbo].[Budget]([categoryId], [month]);
CREATE INDEX [Budget_month_idx] ON [dbo].[Budget]([month]);

ALTER TABLE [dbo].[RecurringRule] ADD CONSTRAINT [RecurringRule_categoryId_fkey] FOREIGN KEY ([categoryId]) REFERENCES [dbo].[Category]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[FinancialEntry] ADD CONSTRAINT [FinancialEntry_categoryId_fkey] FOREIGN KEY ([categoryId]) REFERENCES [dbo].[Category]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[FinancialEntry] ADD CONSTRAINT [FinancialEntry_recurringRuleId_fkey] FOREIGN KEY ([recurringRuleId]) REFERENCES [dbo].[RecurringRule]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Budget] ADD CONSTRAINT [Budget_categoryId_fkey] FOREIGN KEY ([categoryId]) REFERENCES [dbo].[Category]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;