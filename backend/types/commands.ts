export interface SlackBlock {
    type: string;
    text?: {
        type: string;
        text: string;
    };
    fields?: Array<{
        type: string;
        text: string;
    }>;
    [key: string]: any;
}

export interface Command {
    command_name: string;
    command_function: (original_prompt: string, user_name: string) => Promise<string | {text: string; imagePath?: string; jsonPath?: string}>;
    explanation?: string;
}

export interface RegisteredCommand extends Command {
    category_name: string;
}

export interface CommandMap {
    [key: string]: (text: string, userName: string) => Promise<string | {text: string; imagePath?: string; jsonPath?: string}>;
}