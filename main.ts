import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, Modal } from 'obsidian';
import { startOfWeek, format, getWeek } from 'date-fns';

interface MyPluginSettings {
    inputFolder: string;
    outputFolder: string;
    autoGenerateMonthly: boolean;
    weeklyInputFolder: string;
    weeklyOutputFolder: string;
    autoGenerateWeekly: boolean;
    useGPTSummary: boolean;
    gptApiKey: string;
    gptModel: 'gpt-4o' | 'gpt-4o-mini' | 'o1-preview' | 'o1-mini';
    gptInputFolder: string;
    gptOutputFolder: string;
    gptSummarizeOnlyPrevious: boolean;
    gptSystemContent: string;
    gptUserContentPrefix: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
    inputFolder: '5.0 Journal/5.1 Daily',
    outputFolder: '5.0 Journal/5.3 Monthly',
    autoGenerateMonthly: false,
    weeklyInputFolder: '5.0 Journal/5.1 Daily',
    weeklyOutputFolder: '5.0 Journal/5.2 Weekly',
    autoGenerateWeekly: false,
    useGPTSummary: false,
    gptApiKey: '',
    gptModel: 'gpt-4o-mini',
    gptInputFolder: '5.0 Journal/5.2 Weekly',
    gptOutputFolder: '5.0 Journal/5.4 GPT Summaries',
    gptSummarizeOnlyPrevious: true,
    gptSystemContent: "You are a helpful assistant that summarizes weekly journal entries.",
    gptUserContentPrefix: "Please summarize the following weekly journal entries:\n\n",
};

export default class MonthlyRecapPlugin extends Plugin {
    settings: MyPluginSettings;

    async onload() {
        await this.loadSettings();

        // Add a ribbon icon
        this.addRibbonIcon('calendar', 'Generate Monthly Recap', () => {
            this.generateMonthlyRecap();
        });

        // Add commands
        this.addCommand({
            id: 'generate-monthly-recap',
            name: 'Generate Monthly Recap',
            callback: () => this.generateMonthlyRecap(),
        });

        this.addCommand({
            id: 'generate-weekly-recap',
            name: 'Generate Weekly Recap',
            callback: () => this.generateWeeklyRecap(),
        });

        this.addCommand({
            id: 'generate-gpt-summaries',
            name: 'Generate GPT Summaries',
            callback: () => this.generateGPTSummaries(),
        });

        // Add settings tab
        this.addSettingTab(new MonthlyRecapSettingTab(this.app, this));

        // Register interval to check for auto-generation
        this.registerInterval(
            window.setInterval(() => this.checkAutoGenerate(), 3600000) // Check every hour
        );
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async generateMonthlyRecap() {
        const vault = this.app.vault;
        const dailyNotesFolder = this.settings.inputFolder;

        // Get all daily notes
        const dailyNotes = vault.getFiles().filter(
            file => file.path.startsWith(dailyNotesFolder) && file.extension === 'md'
        );

        // Group notes by year and month
        const groupedNotes = this.groupNotesByYearAndMonth(dailyNotes);

        for (const [yearMonth, files] of Object.entries(groupedNotes)) {
            const [year, month] = yearMonth.split('-');
            const outputFileName = `${year}-${month}.md`;
            const outputFilePath = `${this.settings.outputFolder}/${outputFileName}`;

            let recapContent = '';
            for (const file of files) {
                const content = await vault.read(file);
                const cleanedContent = this.cleanFileContent(content);
                recapContent += cleanedContent + '\n\n';
            }

            // Create or update the recap file
            const existingFile = vault.getAbstractFileByPath(outputFilePath);
            if (existingFile instanceof TFile) {
                await vault.modify(existingFile, recapContent);
            } else {
                await vault.create(outputFilePath, recapContent);
            }
        }

        new Notice('Monthly recap generated successfully!');
    }

    groupNotesByYearAndMonth(files: TFile[]): Record<string, TFile[]> {
        const grouped: Record<string, TFile[]> = {};
        for (const file of files) {
            const match = file.name.match(/^(\d{4})-(\d{2})-\d{2}/);
            if (match) {
                const [, year, month] = match;
                const key = `${year}-${month}`;
                if (!grouped[key]) {
                    grouped[key] = [];
                }
                grouped[key].push(file);
            }
        }
        return grouped;
    }

    cleanFileContent(content: string): string {
        // Remove YAML frontmatter
        content = content.replace(/^---\n[\s\S]*?\n---\n/, '');

        // Remove specific blocks
        content = content.replace(/# Dailies\s*\n(?:- \[[ x]\] .*\n?)*/g, '');
        content = content.replace(/```calendar-nav[\s\S]*?```/g, '');
        content = content.replace(/# Daily Law\s*\n(?:- \[[ x]\] .*\n?)*/g, '');

        return content.trim();
    }

    async generateWeeklyRecap() {
        const vault = this.app.vault;
        const dailyNotesFolder = this.settings.weeklyInputFolder;

        // Get all daily notes
        const dailyNotes = vault.getFiles().filter(
            file => file.path.startsWith(dailyNotesFolder) && file.extension === 'md'
        );

        // Group notes by week
        const groupedNotes = this.groupNotesByWeek(dailyNotes);

        for (const [weekStart, files] of Object.entries(groupedNotes)) {
            const weekStartDate = new Date(weekStart);
            const year = weekStartDate.getFullYear();
            const weekNumber = getWeek(weekStartDate, { weekStartsOn: 0 });
            const outputFileName = `${year}-W${weekNumber.toString().padStart(2, '0')}.md`;
            const outputFilePath = `${this.settings.weeklyOutputFolder}/${outputFileName}`;

            let recapContent = '';
            for (const file of files) {
                const content = await vault.read(file);
                const cleanedContent = this.cleanFileContent(content);
                recapContent += cleanedContent + '\n\n';
            }

            if (this.settings.useGPTSummary) {
                recapContent = await this.generateGPTSummary(recapContent);
            }

            // Create or update the recap file
            const existingFile = vault.getAbstractFileByPath(outputFilePath);
            if (existingFile instanceof TFile) {
                await vault.modify(existingFile, recapContent);
            } else {
                await vault.create(outputFilePath, recapContent);
            }
        }

        new Notice('Weekly recaps generated successfully!');
    }

    groupNotesByWeek(files: TFile[]): Record<string, TFile[]> {
        const grouped: Record<string, TFile[]> = {};
        for (const file of files) {
            const match = file.name.match(/^(\d{4}-\d{2}-\d{2})/);
            if (match) {
                const date = new Date(match[1]);
                const weekStart = startOfWeek(date, { weekStartsOn: 0 });
                const key = format(weekStart, 'yyyy-MM-dd');
                if (!grouped[key]) {
                    grouped[key] = [];
                }
                grouped[key].push(file);
            }
        }
        return grouped;
    }

    async generateGPTSummary(content: string): Promise<string> {
        const apiKey = this.settings.gptApiKey;
        if (!apiKey) {
            new Notice('GPT API key is not set. Please set it in the plugin settings.');
            return content;
        }

        try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: this.settings.gptModel,
                    messages: [
                        {
                            role: "system",
                            content: this.settings.gptSystemContent
                        },
                        {
                            role: "user",
                            content: `${this.settings.gptUserContentPrefix}${content}`
                        }
                    ]
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                console.error('API Error Response:', errorData);
                throw new Error(`API Error: ${errorData.error.message}`);
            }

            const data = await response.json();
            if (data.choices && data.choices.length > 0) {
                return data.choices[0].message.content;
            } else {
                throw new Error('No summary generated');
            }
        } catch (error) {
            console.error('Error generating GPT summary:', error);
            new Notice(`Error generating GPT summary: ${error.message}`);
            return content;
        }
    }

    async generateGPTSummaries() {
        const vault = this.app.vault;
        const inputFolder = this.settings.gptInputFolder;
        const outputFolder = this.settings.gptOutputFolder;

        // Get all input files
        const inputFiles = vault.getFiles().filter(
            file => file.path.startsWith(inputFolder) && file.extension === 'md'
        );

        // Sort files by date
        inputFiles.sort((a, b) => a.name.localeCompare(b.name));

        const now = new Date();
        const previousWeekDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const previousWeek = getWeek(previousWeekDate);
        const previousWeekYear = previousWeekDate.getFullYear();

        let weeklyContent = '';

        for (const file of inputFiles) {
            const fileDate = this.getDateFromFileName(file.name);
            if (!fileDate) continue;

            const fileWeek = getWeek(fileDate);
            const fileYear = fileDate.getFullYear();

            if (fileYear === previousWeekYear && fileWeek === previousWeek) {
                const content = await vault.read(file);
                weeklyContent += content + '\n\n';
            }
        }

        if (weeklyContent) {
            const summary = await this.generateGPTSummary(weeklyContent);
            const fileName = `${previousWeekYear}-W${String(previousWeek).padStart(2, '0')} Summary.md`;
            const filePath = `${outputFolder}/${fileName}`;
            await this.app.vault.create(filePath, summary);
        }

        new Notice('GPT weekly summary generated successfully!');
    }

    async generateAndSaveSummary(content: string, type: string, period: number, year: number, outputFolder: string) {
        const summary = await this.generateGPTSummary(content);
        let fileName: string;

        if (type === 'Weekly') {
            fileName = `${year}-W${String(period).padStart(2, '0')} Summary.md`;
        } else if (type === 'Monthly') {
            fileName = `${year}-${String(period).padStart(2, '0')} Summary.md`;
        } else {
            throw new Error('Invalid summary type');
        }

        const filePath = `${outputFolder}/${fileName}`;
        await this.app.vault.create(filePath, summary);
    }

    getDateFromFileName(fileName: string): Date | null {
        const match = fileName.match(/^(\d{4}-\d{2}-\d{2})/);
        return match ? new Date(match[1]) : null;
    }

    checkAutoGenerate() {
        const now = new Date();

        if (this.settings.autoGenerateMonthly) {
            if (now.getDate() === 1 && now.getHours() === 0) {
                this.generateMonthlyRecap();
            }
        }

        if (this.settings.autoGenerateWeekly) {
            if (now.getDay() === 0 && now.getHours() === 0) {
                this.generateWeeklyRecap();
            }
        }
    }

    async generateGPTWeeklySummary() {
        const vault = this.app.vault;
        const inputFolder = this.settings.gptInputFolder;
        const outputFolder = this.settings.gptOutputFolder;

        const inputFiles = vault.getFiles().filter(
            file => file.path.startsWith(inputFolder) && file.extension === 'md'
        );

        inputFiles.sort((a, b) => a.name.localeCompare(b.name));

        const now = new Date();
        const previousWeekDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const previousWeek = getWeek(previousWeekDate);
        const previousWeekYear = previousWeekDate.getFullYear();

        let weeklyContent = '';

        for (const file of inputFiles) {
            const fileDate = this.getDateFromFileName(file.name);
            if (!fileDate) continue;

            const fileWeek = getWeek(fileDate);
            const fileYear = fileDate.getFullYear();

            if (fileYear === previousWeekYear && fileWeek === previousWeek) {
                const content = await vault.read(file);
                weeklyContent += content + '\n\n';
            }
        }

        if (weeklyContent) {
            const summary = await this.generateGPTSummary(weeklyContent);
            const fileName = `${previousWeekYear}-W${String(previousWeek).padStart(2, '0')} Summary.md`;
            const filePath = `${outputFolder}/${fileName}`;
            await this.app.vault.create(filePath, summary);
        }
    }
}

class MonthlyRecapSettingTab extends PluginSettingTab {
    plugin: MonthlyRecapPlugin;

    constructor(app: App, plugin: MonthlyRecapPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        containerEl.createEl('h2', { text: 'Monthly Recap Settings' });

        new Setting(containerEl)
            .setName('Input Folder')
            .setDesc('Folder path for daily notes')
            .addText(text => text
                .setPlaceholder('Example: folder1/folder2')
                .setValue(this.plugin.settings.inputFolder)
                .onChange(async (value) => {
                    this.plugin.settings.inputFolder = value;
                    await this.plugin.saveSettings();
                    this.display();
                }))
            .addButton(button => button
                .setButtonText('Choose Directory')
                .onClick(() => {
                    new FolderSuggestModal(this.app, folder => {
                        this.plugin.settings.inputFolder = folder.path;
                        this.plugin.saveSettings();
                        this.display();
                    }).open();
                }));

        new Setting(containerEl)
            .setName('Output Folder')
            .setDesc('Folder path for monthly recap files')
            .addText(text => text
                .setPlaceholder('Example: folder1/folder2')
                .setValue(this.plugin.settings.outputFolder)
                .onChange(async (value) => {
                    this.plugin.settings.outputFolder = value;
                    await this.plugin.saveSettings();
                    this.display();
                }))
            .addButton(button => button
                .setButtonText('Choose Directory')
                .onClick(() => {
                    new FolderSuggestModal(this.app, folder => {
                        this.plugin.settings.outputFolder = folder.path;
                        this.plugin.saveSettings();
                        this.display();
                    }).open();
                }));

        new Setting(containerEl)
            .setName('Auto Generate Monthly')
            .setDesc('Automatically generate recap for the previous month on the first day of each month')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoGenerateMonthly)
                .onChange(async (value) => {
                    this.plugin.settings.autoGenerateMonthly = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Generate Monthly Recap')
            .setDesc('Generate a monthly recap for all months')
            .addButton(button => button
                .setButtonText('Generate')
                .onClick(async () => {
                    await this.plugin.generateMonthlyRecap();
                    new Notice('Monthly recap generated successfully!');
                }));

        containerEl.createEl('h2', { text: 'Weekly Recap Settings' });

        new Setting(containerEl)
            .setName('Weekly Input Folder')
            .setDesc('Folder path for daily notes')
            .addText(text => text
                .setPlaceholder('Example: folder1/folder2')
                .setValue(this.plugin.settings.weeklyInputFolder)
                .onChange(async (value) => {
                    this.plugin.settings.weeklyInputFolder = value;
                    await this.plugin.saveSettings();
                    this.display();
                }))
            .addButton(button => button
                .setButtonText('Choose Directory')
                .onClick(() => {
                    new FolderSuggestModal(this.app, folder => {
                        this.plugin.settings.weeklyInputFolder = folder.path;
                        this.plugin.saveSettings();
                        this.display();
                    }).open();
                }));

        new Setting(containerEl)
            .setName('Weekly Output Folder')
            .setDesc('Folder path for weekly recap files')
            .addText(text => text
                .setPlaceholder('Example: folder1/folder2')
                .setValue(this.plugin.settings.weeklyOutputFolder)
                .onChange(async (value) => {
                    this.plugin.settings.weeklyOutputFolder = value;
                    await this.plugin.saveSettings();
                    this.display();
                }))
            .addButton(button => button
                .setButtonText('Choose Directory')
                .onClick(() => {
                    new FolderSuggestModal(this.app, folder => {
                        this.plugin.settings.weeklyOutputFolder = folder.path;
                        this.plugin.saveSettings();
                        this.display();
                    }).open();
                }));

        new Setting(containerEl)
            .setName('Auto Generate Weekly')
            .setDesc('Automatically generate recap for the previous week on Sunday at midnight')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoGenerateWeekly)
                .onChange(async (value) => {
                    this.plugin.settings.autoGenerateWeekly = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Use GPT Summary')
            .setDesc('Use GPT to generate summaries for weekly recaps')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.useGPTSummary)
                .onChange(async (value) => {
                    this.plugin.settings.useGPTSummary = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Generate Weekly Recap')
            .setDesc('Generate a weekly recap for all weeks')
            .addButton(button => button
                .setButtonText('Generate')
                .onClick(async () => {
                    await this.plugin.generateWeeklyRecap();
                    new Notice('Weekly recaps generated successfully!');
                }));

        containerEl.createEl('h2', { text: 'GPT Summary Settings' });

        new Setting(containerEl)
            .setName('GPT Model')
            .setDesc('Select the GPT model to use for summaries')
            .addDropdown(dropdown => dropdown
                .addOptions({
                    'gpt-4o': 'gpt-4o',
                    'gpt-4o-mini': 'gpt-4o-mini',
                    'o1-preview': 'o1-preview',
                    'o1-mini': 'o1-mini'
                })
                .setValue(this.plugin.settings.gptModel)
                .onChange(async (value) => {
                    this.plugin.settings.gptModel = value as 'gpt-4o' | 'gpt-4o-mini' | 'o1-preview' | 'o1-mini';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('GPT Input Folder')
            .setDesc('Folder path for input files to summarize')
            .addText(text => text
                .setPlaceholder('Example: folder1/folder2')
                .setValue(this.plugin.settings.gptInputFolder)
                .onChange(async (value) => {
                    this.plugin.settings.gptInputFolder = value;
                    await this.plugin.saveSettings();
                    this.display();
                }))
            .addButton(button => button
                .setButtonText('Choose Directory')
                .onClick(() => {
                    new FolderSuggestModal(this.app, folder => {
                        this.plugin.settings.gptInputFolder = folder.path;
                        this.plugin.saveSettings();
                        this.display();
                    }).open();
                }));

        new Setting(containerEl)
            .setName('GPT Output Folder')
            .setDesc('Folder path for GPT summary output')
            .addText(text => text
                .setPlaceholder('Example: folder1/folder2')
                .setValue(this.plugin.settings.gptOutputFolder)
                .onChange(async (value) => {
                    this.plugin.settings.gptOutputFolder = value;
                    await this.plugin.saveSettings();
                    this.display();
                }))
            .addButton(button => button
                .setButtonText('Choose Directory')
                .onClick(() => {
                    new FolderSuggestModal(this.app, folder => {
                        this.plugin.settings.gptOutputFolder = folder.path;
                        this.plugin.saveSettings();
                        this.display();
                    }).open();
                }));

        new Setting(containerEl)
            .setName('System Content')
            .setDesc('Customize the system content for the GPT API call')
            .addTextArea(text => text
                .setPlaceholder('Enter system content')
                .setValue(this.plugin.settings.gptSystemContent)
                .onChange(async (value) => {
                    this.plugin.settings.gptSystemContent = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('User Content Prefix')
            .setDesc('Customize the prefix for the user content in the GPT API call')
            .addTextArea(text => text
                .setPlaceholder('Enter user content prefix')
                .setValue(this.plugin.settings.gptUserContentPrefix)
                .onChange(async (value) => {
                    this.plugin.settings.gptUserContentPrefix = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Generate GPT Summaries')
            .setDesc('Generate GPT summaries for weekly and monthly notes')
            .addButton(button => button
                .setButtonText('Generate')
                .onClick(async () => {
                    await this.plugin.generateGPTSummaries();
                    new Notice('GPT summaries generated successfully!');
                }));

        new Setting(containerEl)
            .setName('GPT API Key')
            .setDesc('API key for OpenAI GPT')
            .addText(text => text
                .setPlaceholder('Enter your API key')
                .setValue(this.plugin.settings.gptApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.gptApiKey = value;
                    await this.plugin.saveSettings();
                }));
    }
}

class FolderSuggestModal extends Modal {
    private result: (folder: TFolder) => void;

    constructor(app: App, onChoose: (folder: TFolder) => void) {
        super(app);
        this.result = onChoose;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Choose a folder' });

        const folderList = contentEl.createEl('ul');
        const folders = this.app.vault.getAllLoadedFiles().filter(
            f => f instanceof TFolder
        ) as TFolder[];

        folders.forEach(folder => {
            const item = folderList.createEl('li');
            item.setText(folder.path);
            item.onclick = () => {
                this.result(folder);
                this.close();
            };
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
